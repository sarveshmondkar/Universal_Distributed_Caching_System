/** In-memory stand-ins for cache nodes, so cluster logic can be tested without a network. */
export class FakeNode {
  constructor(url) {
    this.url = url;
    this.store = new Map();
    this.down = false;
    this.calls = { get: 0, peek: 0, post: 0, delete: 0 };
  }

  handle(method, path, body, now = Date.now()) {
    if (this.down) {
      const error = new Error("connect ECONNREFUSED");
      error.code = "ECONNREFUSED";
      throw error;
    }
    const [pathname, query = ""] = path.split("?");
    if (method === "get" && pathname === "/health") return { status: 200, data: { status: "ok", size: this.store.size, capacity: 100 } };
    if (method === "get" && pathname === "/entries") return { status: 200, data: { entries: [...this.store].map(([key, entry]) => ({ key, ...entry })) } };
    if (method === "get" && pathname === "/keys") return { status: 200, data: { keys: [...this.store].map(([key, entry]) => ({ key, expiresAt: entry.expiresAt })) } };
    if (method === "post" && pathname === "/") {
      this.calls.post++;
      this.store.set(body.key, { value: body.value, expiresAt: body.ttl === undefined ? undefined : now + body.ttl });
      return { status: 201, data: { message: "Data stored successfully", key: body.key, value: body.value } };
    }
    if (method === "delete" && pathname === "/") {
      const removed = this.store.size;
      this.store.clear();
      return { status: 200, data: { removed } };
    }
    if (method === "delete" && pathname.startsWith("/delete/")) {
      this.calls.delete++;
      const key = decodeURIComponent(pathname.slice("/delete/".length));
      return this.store.delete(key) ? { status: 200, data: { message: "Key deleted successfully" } } : { status: 404, data: { message: "Key not found" } };
    }
    if (method === "get" && pathname.startsWith("/has/")) {
      const key = decodeURIComponent(pathname.slice("/has/".length));
      return { status: 200, data: { key, exists: this.store.has(key) } };
    }
    if (method === "get") {
      query.includes("peek=true") ? this.calls.peek++ : this.calls.get++;
      const key = decodeURIComponent(pathname.slice(1));
      const entry = this.store.get(key);
      if (!entry || (entry.expiresAt !== undefined && entry.expiresAt <= now)) return { status: 404, data: { message: "key not found or expired" } };
      return { status: 200, data: { key, value: entry.value, expiresAt: entry.expiresAt ?? null } };
    }
    return { status: 404, data: {} };
  }
}

export function fakeHttp(nodes, { now = Date.now } = {}) {
  const byUrl = new Map(nodes.map((node) => [node.url, node]));
  const dispatch = async (method, url, body) => {
    const parsed = new URL(url);
    const node = byUrl.get(parsed.origin);
    if (!node) throw Object.assign(new Error("ENOTFOUND"), { code: "ENOTFOUND" });
    return node.handle(method, `${parsed.pathname.replace(/^\/cache/, "") || "/"}${parsed.search}`, body, now());
  };
  return {
    get: (url) => dispatch("get", url),
    post: (url, body) => dispatch("post", url, body),
    delete: (url) => dispatch("delete", url),
  };
}

export function makeCluster(ClusterService, { count = 3, replicationFactor = 1, virtualNodes = 50, extra = 0, ...options } = {}) {
  const all = Array.from({ length: count + extra }, (_, i) => new FakeNode(`http://node${i + 1}:4001`));
  const active = all.slice(0, count);
  const service = new ClusterService({ nodes: active.map((node) => node.url), http: fakeHttp(all), replicationFactor, virtualNodes, ...options });
  return { service, nodes: all, byUrl: Object.fromEntries(all.map((node) => [node.url, node])) };
}
