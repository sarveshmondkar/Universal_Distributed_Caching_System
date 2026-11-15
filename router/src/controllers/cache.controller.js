import { ClusterError } from "../services/cluster.js";

/**
 * Adapt a service call that resolves to { status, body } into an Express handler.
 * ClusterError carries an HTTP status; anything else is an unexpected 500.
 */
export const handle = (action) => async (req, res) => {
  try {
    const { status = 200, body } = await action(req);
    return res.status(status).json(body);
  } catch (error) {
    if (error instanceof ClusterError) return res.status(error.status).json({ message: error.message });
    console.error(error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

export function createCacheController(cluster) {
  return {
    health: handle(() => cluster.checkHealth()),
    setCache: handle((req) => cluster.set(req.body ?? {})),
    getCache: handle((req) => cluster.get(req.params.key, { peek: req.query.peek === "true" })),
    hasCache: handle((req) => cluster.has(req.params.key)),
    deleteCache: handle((req) => cluster.delete(req.params.key)),
    flushCache: handle(() => cluster.flush()),
    listCacheKeys: handle((req) => cluster.listKeys({ q: req.query.q, limit: req.query.limit })),
    locateKey: handle((req) => cluster.locate(req.params.key)),
    getCacheSize: handle(() => cluster.size()),
    getCacheStats: handle(() => cluster.stats()),
    debugCache: handle((req) => cluster.debug(req.query.limit)),
  };
}
