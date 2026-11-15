import { handle } from "./cache.controller.js";

export function createClusterController(cluster) {
  return {
    ring: handle(() => cluster.ringSnapshot()),
    metrics: handle(() => cluster.metricsSnapshot()),
    addNode: handle((req) => cluster.addNode(req.body?.url)),
    removeNode: handle((req) => cluster.removeNode(req.query.url)),
    rebalance: handle(async () => ({ status: 200, body: { message: "Rebalance complete", rebalance: await cluster.rebalance() } })),
  };
}
