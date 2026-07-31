import { Router } from "express";
import {
  setCache,
  getCache,
  deleteCache,
  getCacheSize,
  hasCache,
} from "../controllers/cache.controller.js";

const router = Router();

router.post("/", setCache);
router.get("/cache-size", getCacheSize);
router.get("/has/:key", hasCache);
router.get("/:key", getCache);
router.delete("/delete/:key", deleteCache);
router.get("/debug", debugCache);

export default router;
