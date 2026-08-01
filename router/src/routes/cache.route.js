import express from "express";
import { setCache } from "../controllers/cache.controller.js";

const router = express.Router();

router.post("/", setCache);

export default router;