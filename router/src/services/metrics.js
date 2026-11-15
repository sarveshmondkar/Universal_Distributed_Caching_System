/**
 * Router-side request metrics: per-operation counters, latency percentiles, a rolling
 * throughput window, and a short feed of recent requests for the dashboard.
 *
 * Hit rate measured here is what clients actually experience. Summing per-node counters
 * overstates misses because one missed read can touch several replicas.
 */
const percentile = (sorted, p) => {
  if (!sorted.length) return 0;
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, index)];
};

const round = (value) => Math.round(value * 100) / 100;

export class Metrics {
  constructor({ maxSamples = 1000, maxEvents = 60, windowSeconds = 60, now = Date.now } = {}) {
    this.now = now;
    this.maxSamples = maxSamples;
    this.maxEvents = maxEvents;
    this.windowSeconds = windowSeconds;
    this.startedAt = now();
    this.ops = new Map();
    this.counters = new Map();
    this.events = [];
    this.buckets = new Map();
  }

  _op(name) {
    if (!this.ops.has(name)) this.ops.set(name, { count: 0, hits: 0, misses: 0, errors: 0, samples: [], totalMs: 0 });
    return this.ops.get(name);
  }

  /** Record one client-facing request. `outcome` is hit | miss | ok | error. */
  record({ op, key, status, ms, outcome = "ok", node, detail }) {
    const entry = this._op(op);
    entry.count++;
    entry.totalMs += ms;
    if (outcome === "hit") entry.hits++;
    else if (outcome === "miss") entry.misses++;
    else if (outcome === "error") entry.errors++;
    entry.samples.push(ms);
    if (entry.samples.length > this.maxSamples) entry.samples.shift();

    const at = this.now();
    this.events.unshift({ at, op, key: key ?? null, status, outcome, ms: round(ms), node: node ?? null, detail: detail ?? null });
    if (this.events.length > this.maxEvents) this.events.pop();

    const second = Math.floor(at / 1000);
    this.buckets.set(second, (this.buckets.get(second) || 0) + 1);
    for (const stale of this.buckets.keys()) if (stale <= second - this.windowSeconds) this.buckets.delete(stale);
  }

  /** Count internal events such as read repairs or rebalance moves. */
  increment(name, amount = 1) {
    this.counters.set(name, (this.counters.get(name) || 0) + amount);
  }

  snapshot() {
    const at = this.now();
    const second = Math.floor(at / 1000);
    const ops = {};
    let requests = 0;
    let errors = 0;
    for (const [name, entry] of this.ops) {
      const sorted = [...entry.samples].sort((a, b) => a - b);
      requests += entry.count;
      errors += entry.errors;
      ops[name] = {
        count: entry.count, hits: entry.hits, misses: entry.misses, errors: entry.errors,
        avgMs: entry.count ? round(entry.totalMs / entry.count) : 0,
        p50: round(percentile(sorted, 50)), p95: round(percentile(sorted, 95)), p99: round(percentile(sorted, 99)),
      };
    }
    const get = ops.get || { hits: 0, misses: 0 };
    const reads = get.hits + get.misses;
    let recent = 0;
    for (let s = second - 9; s <= second; s++) recent += this.buckets.get(s) || 0;
    return {
      startedAt: this.startedAt,
      uptimeSeconds: Math.floor((at - this.startedAt) / 1000),
      totals: { requests, errors },
      reads: { count: reads, hits: get.hits, misses: get.misses, hitRate: reads ? get.hits / reads : null },
      requestsPerSecond: round(recent / 10),
      ops,
      counters: Object.fromEntries(this.counters),
      recent: this.events,
    };
  }
}
