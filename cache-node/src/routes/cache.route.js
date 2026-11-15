import { Router } from "express";
import {
  setCache,
  getCache,
  deleteCache,
  getCacheSize,
  hasCache,
  debugCache,
  getCacheStats,
  health,
  listCacheKeys,
  listEntries,
  flushCache,
} from "../controllers/cache.controller.js";

const router = Router();

router.get("/health", health);
router.get("/keys", listCacheKeys);
router.get("/entries", listEntries);
router.post("/", setCache);
router.delete("/", flushCache);
router.get("/cache-size", getCacheSize);
router.get("/debug", debugCache);
router.get("/stats", getCacheStats);

router.get("/has/:key", hasCache);
router.get("/:key", getCache);
router.delete("/delete/:key", deleteCache);

export default router;
