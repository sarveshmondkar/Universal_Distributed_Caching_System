import axios from "axios";
import { ClusterService } from "./cluster.js";
import { configuredNodes } from "./nodeSelector.js";

/** Build the cluster coordinator from environment configuration. */
export function createCluster(env = process.env) {
  const http = axios.create({ timeout: Number(env.NODE_TIMEOUT_MS || 1500), validateStatus: () => true });
  return new ClusterService({
    nodes: configuredNodes(),
    http,
    replicationFactor: Number(env.REPLICATION_FACTOR || 1),
    virtualNodes: Number(env.VIRTUAL_NODES || 100),
  });
}
