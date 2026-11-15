import express from "express";

export function clusterRoutes(controller) {
  const router = express.Router();

  router.get("/ring", controller.ring);
  router.get("/metrics", controller.metrics);
  router.post("/nodes", controller.addNode);
  router.delete("/nodes", controller.removeNode);
  router.post("/rebalance", controller.rebalance);

  return router;
}
