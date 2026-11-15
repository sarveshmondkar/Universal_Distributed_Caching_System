import express from "express";
import cacheRoutes from "./routes/cache.route.js"

const app = express();

//Middleware
app.use(express.json({ limit: process.env.MAX_REQUEST_BYTES || "2mb" }));
app.use(express.urlencoded({extended:true}));

//Routes
app.use("/cache", cacheRoutes);
app.get("/health", (_req, res) => res.json({ status: "ok", role: "cache-node" }));
app.use((error, _req, res, _next) => {
  if (error instanceof SyntaxError && "body" in error) return res.status(400).json({ message: "Invalid JSON body" });
  return res.status(500).json({ message: "Internal server error" });
});


export default app;
