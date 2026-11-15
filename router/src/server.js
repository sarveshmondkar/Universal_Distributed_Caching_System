import "dotenv/config";
import { createApp } from "./app.js";
import { createCluster } from "./services/instance.js";

const PORT = process.env.PORT || 3000;

const cluster = createCluster();
cluster.startHealthChecks(Number(process.env.HEALTH_INTERVAL_MS || 3000));
cluster.checkHealth().catch(() => {});

const server = createApp(cluster).listen(PORT, () => {
  console.log(`Router running on port ${PORT} (${cluster.nodes.length} nodes, replication factor ${cluster.replicationFactor})`);
});

const shutdown = () => {
  cluster.stopHealthChecks();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 2000).unref();
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
