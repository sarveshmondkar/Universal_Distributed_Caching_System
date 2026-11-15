import express from "express";

export function cacheRoutes(controller) {
  const router = express.Router();

  router.get("/health", controller.health);
  router.get("/keys", controller.listCacheKeys);
  router.post("/", controller.setCache);
  router.delete("/", controller.flushCache);
  router.get("/cache-size", controller.getCacheSize);
  router.get("/debug", controller.debugCache);
  router.get("/stats", controller.getCacheStats);

  router.get("/locate/:key", controller.locateKey);
  router.get("/has/:key", controller.hasCache);
  router.get("/:key", controller.getCache);
  router.delete("/delete/:key", controller.deleteCache);

  return router;
}
