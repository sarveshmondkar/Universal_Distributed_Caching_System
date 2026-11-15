import express from "express";
import { cacheRoutes } from "./routes/cache.route.js";
import { clusterRoutes } from "./routes/cluster.route.js";
import { createCacheController } from "./controllers/cache.controller.js";
import { createClusterController } from "./controllers/cluster.controller.js";

export function createApp(cluster) {
  const app = express();

  app.use(express.json({ limit: process.env.MAX_REQUEST_BYTES || "2mb" }));

  app.get("/health", (_req, res) => res.json({ status: "ok", role: "router" }));
  app.use("/cache", cacheRoutes(createCacheController(cluster)));
  app.use("/cluster", clusterRoutes(createClusterController(cluster)));

  app.use((error, _req, res, _next) => {
    if (error instanceof SyntaxError && "body" in error) return res.status(400).json({ message: "Invalid JSON body" });
    if (error.status === 413) return res.status(413).json({ message: "Request body is too large" });
    console.error(error);
    return res.status(500).json({ message: "Internal server error" });
  });

  return app;
}
