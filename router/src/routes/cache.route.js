import express from "express";
import { setCache,getCache,hasCache,deleteCache,getCacheSize,getCacheStats,debugCache } from "../controllers/cache.controller.js";

const router = express.Router();

router.post("/", setCache);
router.get("/cache-size", getCacheSize);
router.get("/debug", debugCache);
router.get("/stats", getCacheStats);

router.get("/has/:key", hasCache);
router.get("/:key", getCache);
router.delete("/delete/:key", deleteCache);

export default router;