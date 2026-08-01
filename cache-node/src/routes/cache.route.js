import { Router } from "express";
import {
  setCache,
  getCache,
  deleteCache,
  getCacheSize,
  hasCache,
  debugCache,
  getCacheStats,
} from "../controllers/cache.controller.js";

const router = Router();

router.post("/", setCache);
router.get("/cache-size", getCacheSize);
router.get("/debug", debugCache);
router.get("/stats", getCacheStats);

router.get("/has/:key", hasCache);
router.get("/:key", getCache);
router.delete("/delete/:key", deleteCache);

export default router;
