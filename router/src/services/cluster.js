import { performance } from "node:perf_hooks";
import { NodeSelector } from "./nodeSelector.js";
import { Metrics } from "./metrics.js";
import { planRebalance } from "./rebalance.js";

export class ClusterError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const endpoint = (node, path) => `${node}/cache${path}`;
const keyPath = (key) => `/${encodeURIComponent(key)}`;
const elapsed = (started) => performance.now() - started;

export function normalizeNodeUrl(raw) {
  const text = String(raw ?? "").trim();
  try {
    const url = new URL(text);
    if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("unsupported protocol");
    return `${url.protocol}//${url.host}`;
  } catch {
    if (!text) throw new ClusterError(400, "A node URL is required");
    throw new ClusterError(400, `"${text}" is not a valid http(s) URL`);
  }
}

async function runPool(tasks, limit) {
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, tasks.length) }, async () => {
    while (next < tasks.length) await tasks[next++]();
  });
  await Promise.all(workers);
}

/**
 * Coordinates a set of cache nodes: routing on the hash ring, replication, failover,
 * read repair, health tracking, and membership changes with rebalancing.
 *
 * `http` must expose get/post/delete(url[, body]) returning { status, data } and throwing on
 * network errors or timeouts. Passing it in keeps this class testable without a real network.
 *
 * Guarantees are deliberately modest: writes need one node to accept them, replica writes are
 * best effort, and there is no versioning, so concurrent writers race. See the README.
 */
export class ClusterService {
  constructor({
    nodes, http, replicationFactor = 1, virtualNodes = 100, metrics = new Metrics(),
    now = Date.now, failureThreshold = 2, concurrency = 16,
  }) {
    this.http = http;
    this.configuredReplication = Math.max(1, Number(replicationFactor) || 1);
    this.virtualNodes = virtualNodes;
    this.metrics = metrics;
    this.now = now;
    this.failureThreshold = failureThreshold;
    this.concurrency = concurrency;
    this.health = new Map();
    this.ringVersion = 0;
    this.background = new Set();
    this.timer = null;
    this._setNodes(nodes.map((node) => normalizeNodeUrl(node)));
  }

  /* ----------------------------- membership & health ----------------------------- */

  _setNodes(nodes) {
    this.nodes = [...new Set(nodes)];
    this.selector = new NodeSelector(this.nodes, this.virtualNodes);
    for (const node of this.nodes) this._state(node);
    for (const known of [...this.health.keys()]) if (!this.nodes.includes(known)) this.health.delete(known);
    this.ringVersion++;
  }

  _state(node) {
    if (!this.health.has(node)) {
      this.health.set(node, { healthy: true, failures: 0, lastCheckedAt: null, lastError: null, latencyMs: null });
    }
    return this.health.get(node);
  }

  get replicationFactor() {
    return Math.max(1, Math.min(this.nodes.length || 1, this.configuredReplication));
  }

  isUp(node) {
    return this.health.get(node)?.healthy !== false;
  }

  _markSuccess(node, latencyMs) {
    const state = this._state(node);
    state.healthy = true;
    state.failures = 0;
    state.lastError = null;
    if (latencyMs != null) state.latencyMs = Math.round(latencyMs * 10) / 10;
  }

  /** A single passive failure is tolerated; repeated ones (or a failed active probe) open the circuit. */
  _markFailure(node, reason, { immediate = false } = {}) {
    const state = this._state(node);
    state.failures++;
    state.lastError = reason;
    if (immediate || state.failures >= this.failureThreshold) state.healthy = false;
  }

  /** Send one request to one node. Never throws; the result says whether the node answered. */
  async _request(node, method, path, body) {
    const started = performance.now();
    try {
      const url = endpoint(node, path);
      const response = method === "post" ? await this.http.post(url, body) : await this.http[method](url);
      if (response.status >= 500) {
        this._markFailure(node, `HTTP ${response.status}`);
        return { ok: false, status: response.status, data: response.data };
      }
      this._markSuccess(node, elapsed(started));
      return { ok: true, status: response.status, data: response.data };
    } catch (error) {
      this._markFailure(node, error?.code || error?.message || "request failed");
      return { ok: false, status: 0, error };
    }
  }

  /** Nodes believed to be up come first (in ring order); suspected-down nodes are a last resort. */
  preferenceList(key) {
    const ordered = this.selector.ordered(key);
    return [...ordered.filter((node) => this.isUp(node)), ...ordered.filter((node) => !this.isUp(node))];
  }

  async checkHealth() {
    const results = await Promise.all(this.nodes.map(async (node) => {
      const started = performance.now();
      const result = await this._request(node, "get", "/health");
      const state = this._state(node);
      state.lastCheckedAt = this.now();
      const healthy = result.ok && result.status === 200;
      if (healthy) this._markSuccess(node, elapsed(started));
      else this._markFailure(node, state.lastError || `HTTP ${result.status}`, { immediate: true });
      return {
        node, healthy,
        ...(healthy ? { details: result.data } : {}),
        latencyMs: state.latencyMs, consecutiveFailures: state.failures,
        lastError: healthy ? null : state.lastError, lastCheckedAt: state.lastCheckedAt,
      };
    }));
    const healthy = results.filter((item) => item.healthy).length;
    return {
      status: healthy ? 200 : 503,
      body: {
        status: healthy ? "ok" : "unavailable", healthyNodes: healthy, totalNodes: this.nodes.length,
        replicationFactor: this.replicationFactor, virtualNodes: this.virtualNodes, ringVersion: this.ringVersion,
        nodes: results,
      },
    };
  }

  startHealthChecks(intervalMs = 3000) {
    this.stopHealthChecks();
    this.timer = setInterval(() => { this.checkHealth().catch(() => {}); }, intervalMs);
    this.timer.unref?.();
  }

  stopHealthChecks() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Resolves once fire-and-forget work (read repair) has finished. Used by tests and shutdown. */
  async idle() {
    while (this.background.size) await Promise.allSettled([...this.background]);
  }

  _spawn(promise) {
    const tracked = promise.catch(() => {}).finally(() => this.background.delete(tracked));
    this.background.add(tracked);
  }

  /* --------------------------------- data path ---------------------------------- */

  async set({ key, value, ttl } = {}) {
    const started = performance.now();
    if (typeof key !== "string" || !key.trim() || value === undefined) {
      throw new ClusterError(400, "A non-empty string key and value are required");
    }
    const list = this.preferenceList(key);
    if (!list.length) throw new ClusterError(503, "No cache nodes are configured");

    const payload = { key, value, ...(ttl !== undefined && ttl !== null ? { ttl } : {}) };
    let primary;
    let index = 0;
    for (; index < list.length; index++) {
      const result = await this._request(list[index], "post", "/", payload);
      if (result.ok) { primary = result; break; }
    }
    if (!primary) {
      this.metrics.record({ op: "set", key, status: 503, ms: elapsed(started), outcome: "error" });
      throw new ClusterError(503, "All cache nodes are unavailable");
    }
    const primaryNode = list[index];
    if (primary.status >= 400) {
      this.metrics.record({ op: "set", key, status: primary.status, ms: elapsed(started), outcome: "error", node: primaryNode });
      return { status: primary.status, body: primary.data };
    }

    const replicaNodes = list.slice(index + 1, index + this.replicationFactor);
    const replicas = await Promise.all(replicaNodes.map(async (node) => {
      const result = await this._request(node, "post", "/", payload);
      return { node, healthy: result.ok && result.status < 400 };
    }));
    this.metrics.record({
      op: "set", key, status: primary.status, ms: elapsed(started), outcome: "ok", node: primaryNode,
      detail: `${replicas.filter((replica) => replica.healthy).length}/${replicas.length} replicas`,
    });
    return { status: primary.status, body: { ...primary.data, primary: primaryNode, replicas } };
  }

  /**
   * Read from the first `replicationFactor` reachable nodes in preference order, stopping at the
   * first hit. Misses count only against nodes that actually answered, and a hit found after
   * earlier owners missed repairs those owners in the background (read repair).
   * With `peek` the node does not touch LRU order or its counters, and no repair happens.
   */
  async get(key, { peek = false } = {}) {
    const started = performance.now();
    const op = peek ? "peek" : "get";
    const list = this.preferenceList(key);
    if (!list.length) throw new ClusterError(503, "No cache nodes are configured");

    const rf = this.replicationFactor;
    const natural = this.selector.ordered(key).slice(0, rf);
    let incomplete = natural.some((node) => !this.isUp(node));
    const missed = [];
    let consulted = 0;
    const path = keyPath(key) + (peek ? "?peek=true" : "");

    for (const node of list) {
      if (consulted >= rf) break;
      const result = await this._request(node, "get", path);
      if (!result.ok) { if (natural.includes(node)) incomplete = true; continue; }
      consulted++;
      if (result.status === 200) {
        if (!peek && missed.length) this._readRepair(key, result.data, missed.filter((n) => natural.includes(n)));
        this.metrics.record({ op, key, status: 200, ms: elapsed(started), outcome: "hit", node });
        return { status: 200, body: { ...result.data, servedBy: node } };
      }
      if (result.status === 404) { missed.push(node); continue; }
      this.metrics.record({ op, key, status: result.status, ms: elapsed(started), outcome: "error", node });
      return { status: result.status, body: result.data };
    }

    if (incomplete) {
      this.metrics.record({ op, key, status: 503, ms: elapsed(started), outcome: "error" });
      return { status: 503, body: { message: "One or more cache nodes are unavailable; lookup may be incomplete" } };
    }
    this.metrics.record({ op, key, status: 404, ms: elapsed(started), outcome: "miss" });
    return { status: 404, body: { message: "key not found or expired" } };
  }

  _readRepair(key, found, nodes) {
    if (!nodes.length) return;
    let ttl;
    if (found.expiresAt != null) {
      ttl = found.expiresAt - this.now();
      if (ttl <= 0) return;
    }
    const payload = { key, value: found.value, ...(ttl !== undefined ? { ttl } : {}) };
    this._spawn((async () => {
      const results = await Promise.all(nodes.map((node) => this._request(node, "post", "/", payload)));
      const repaired = results.filter((result) => result.ok && result.status < 400).length;
      if (repaired) this.metrics.increment("readRepairs", repaired);
    })());
  }

  async delete(key) {
    const started = performance.now();
    const rf = this.replicationFactor;
    // Delete from the ring's replica set and from wherever failover may have placed copies.
    const destinations = [...new Set([...this.selector.ordered(key).slice(0, rf), ...this.preferenceList(key).slice(0, rf)])];
    const results = await Promise.all(destinations.map(async (node) => {
      const result = await this._request(node, "delete", `/delete/${encodeURIComponent(key)}`);
      return { node, status: result.status || 503, data: result.data };
    }));
    const ms = elapsed(started);
    if (!results.some((result) => result.status < 300)) {
      if (results.some((result) => result.status >= 500)) {
        this.metrics.record({ op: "delete", key, status: 503, ms, outcome: "error" });
        return { status: 503, body: { message: "Cache nodes are unavailable; delete may be incomplete", results } };
      }
      this.metrics.record({ op: "delete", key, status: 404, ms, outcome: "miss" });
      return { status: 404, body: { message: "Key not found" } };
    }
    this.metrics.record({ op: "delete", key, status: 200, ms, outcome: "ok", detail: `${results.filter((r) => r.status < 300).length} copies` });
    return { status: 200, body: { message: "Delete propagated", results } };
  }

  async _fanout(path) {
    const results = await Promise.all(this.nodes.map(async (node) => {
      const result = await this._request(node, "get", path);
      return { node, status: result.status || 503, data: result.ok || result.data ? result.data : { message: "unavailable" } };
    }));
    const available = results.filter((item) => item.status < 500);
    if (!available.length) throw new ClusterError(503, "Cache nodes are unavailable");
    return { nodes: results, availableNodes: available.length };
  }

  async has(key) {
    const started = performance.now();
    const body = await this._fanout(`/has/${encodeURIComponent(key)}`);
    const exists = body.nodes.some((item) => item.data?.exists === true);
    this.metrics.record({ op: "has", key, status: 200, ms: elapsed(started), outcome: exists ? "hit" : "miss" });
    return { status: 200, body: { key, exists, ...body } };
  }

  async size() { return { status: 200, body: await this._fanout("/cache-size") }; }
  async stats() { return { status: 200, body: await this._fanout("/stats") }; }
  async debug(limit) { return { status: 200, body: await this._fanout(`/debug${limit ? `?limit=${encodeURIComponent(limit)}` : ""}`) }; }

  async listKeys({ q = "", limit = 1000 } = {}) {
    const results = await Promise.all(this.nodes.map(async (node) => {
      const result = await this._request(node, "get", "/keys");
      return { node, status: result.status || 503, data: result.data };
    }));
    const available = results.filter((result) => result.status < 500);
    if (!available.length) throw new ClusterError(503, "Cache nodes are unavailable");

    const merged = new Map();
    for (const result of available) {
      for (const entry of result.data?.keys || []) {
        const current = merged.get(entry.key);
        if (current) current.nodes.push(result.node);
        else merged.set(entry.key, { ...entry, nodes: [result.node] });
      }
    }
    const rf = this.replicationFactor;
    const term = String(q).trim().toLowerCase();
    let keys = [...merged.values()].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
    const total = keys.length;
    if (term) keys = keys.filter((entry) => entry.key.toLowerCase().includes(term));
    const matched = keys.length;
    keys = keys.slice(0, Math.max(1, Math.min(5000, Number(limit) || 1000))).map((entry) => {
      const owners = this.selector.ordered(entry.key).slice(0, rf);
      return {
        ...entry,
        position: this.selector.locate(entry.key).position,
        owners,
        underReplicated: owners.some((owner) => !entry.nodes.includes(owner)),
      };
    });
    return { status: 200, body: { keys, total, matched, availableNodes: available.length, totalNodes: this.nodes.length } };
  }

  /** Explain where a key lives: its hash, its place on the ring, and who owns it. */
  locate(key) {
    if (typeof key !== "string" || !key.length) throw new ClusterError(400, "A key is required");
    const { hash, position } = this.selector.locate(key);
    const rf = this.replicationFactor;
    const walk = this.selector.walk(key).map((entry, index) => ({
      node: entry.node, position: entry.position, healthy: this.isUp(entry.node),
      role: index === 0 ? "primary" : index < rf ? "replica" : "standby",
    }));
    return { status: 200, body: { key, hash, position, replicationFactor: rf, owners: walk.filter((item) => item.role !== "standby"), walk } };
  }

  ringSnapshot() {
    const snapshot = this.selector.snapshot();
    return {
      status: 200,
      body: {
        ...snapshot, replicationFactor: this.replicationFactor, ringVersion: this.ringVersion,
        nodes: snapshot.nodes.map((entry) => ({ ...entry, healthy: this.isUp(entry.node) })),
      },
    };
  }

  async flush() {
    const results = await Promise.all(this.nodes.map(async (node) => {
      const result = await this._request(node, "delete", "/");
      return { node, status: result.status || 503, removed: result.data?.removed ?? 0 };
    }));
    const removed = results.reduce((sum, item) => sum + item.removed, 0);
    this.metrics.record({ op: "flush", key: null, status: 200, ms: 0, outcome: "ok", detail: `${removed} entries` });
    return { status: 200, body: { message: "Cluster flushed", removed, nodes: results } };
  }

  /* ------------------------- membership & rebalancing --------------------------- */

  async addNode(raw) {
    const node = normalizeNodeUrl(raw);
    if (this.nodes.includes(node)) throw new ClusterError(409, "That node is already in the cluster");
    const probe = await this._request(node, "get", "/health");
    if (!probe.ok || probe.status !== 200) {
      this.health.delete(node);
      throw new ClusterError(502, `Could not reach ${node}/cache/health. Start the node first, then add it.`);
    }
    this._setNodes([...this.nodes, node]);
    const rebalance = await this.rebalance();
    return { status: 201, body: { message: "Node added", node, nodes: this.nodes, rebalance } };
  }

  /** Remove a node after copying its entries to their new owners. */
  async removeNode(raw) {
    const node = normalizeNodeUrl(raw);
    if (!this.nodes.includes(node)) throw new ClusterError(404, "That node is not in the cluster");
    if (this.nodes.length === 1) throw new ClusterError(409, "Cannot remove the last node");
    this._setNodes(this.nodes.filter((item) => item !== node));
    const rebalance = await this.rebalance({ leaving: [node] });
    this.health.delete(node);
    return { status: 200, body: { message: "Node removed", node, nodes: this.nodes, rebalance } };
  }

  /**
   * Make every key live on exactly the nodes the ring assigns it to: copy missing replicas first,
   * then delete surplus copies. Keys whose copy failed keep their old holders, so a partial
   * failure never loses data.
   */
  async rebalance({ leaving = [] } = {}) {
    const started = performance.now();
    const sources = [...new Set([...this.nodes, ...leaving])];
    const holdings = new Map();
    const unreachable = [];
    await Promise.all(sources.map(async (node) => {
      const result = await this._request(node, "get", "/entries");
      if (result.ok && result.status === 200) holdings.set(node, result.data?.entries || []);
      else unreachable.push(node);
    }));

    const plan = planRebalance({ holdings, selector: this.selector, replicationFactor: this.replicationFactor, leaving, now: this.now() });

    let copied = 0;
    let removed = 0;
    let failed = 0;
    const failedKeys = new Set();
    await runPool(plan.copies.map((copy) => async () => {
      const body = { key: copy.key, value: copy.value, ...(copy.ttl !== undefined ? { ttl: copy.ttl } : {}) };
      const result = await this._request(copy.node, "post", "/", body);
      if (result.ok && result.status < 400) copied++;
      else { failed++; failedKeys.add(copy.key); }
    }), this.concurrency);

    await runPool(plan.deletes.filter((item) => !failedKeys.has(item.key)).map((item) => async () => {
      const result = await this._request(item.node, "delete", `/delete/${encodeURIComponent(item.key)}`);
      if (result.ok && (result.status < 300 || result.status === 404)) removed++;
      else failed++;
    }), this.concurrency);

    this.metrics.increment("rebalanceCopies", copied);
    this.metrics.increment("rebalanceRemovals", removed);
    const summary = { scanned: plan.scanned, copied, removed, failed, unreachable, durationMs: Math.round(elapsed(started)) };
    this.metrics.record({ op: "rebalance", key: null, status: failed ? 207 : 200, ms: elapsed(started), outcome: failed ? "error" : "ok", detail: `${copied} copied, ${removed} removed` });
    return summary;
  }

  metricsSnapshot() {
    return { status: 200, body: this.metrics.snapshot() };
  }
}
