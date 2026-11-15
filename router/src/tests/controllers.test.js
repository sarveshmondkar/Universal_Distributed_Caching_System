import test from "node:test";
import assert from "node:assert/strict";
import { ClusterService } from "../services/cluster.js";
import { createCacheController } from "../controllers/cache.controller.js";
import { createClusterController } from "../controllers/cluster.controller.js";
import { makeCluster } from "./helpers.js";

function call(handler, { params = {}, query = {}, body } = {}) {
  return new Promise((resolve) => {
    const res = {
      statusCode: 200,
      status(code) { this.statusCode = code; return this; },
      json(payload) { resolve({ status: this.statusCode, body: payload }); return this; },
    };
    handler({ params, query, body }, res);
  });
}

test("controllers translate service results and ClusterError into HTTP responses", async () => {
  const { service } = makeCluster(ClusterService, { replicationFactor: 2 });
  const cache = createCacheController(service);

  const created = await call(cache.setCache, { body: { key: "user:1", value: { name: "Ada" }, ttl: 60000 } });
  assert.equal(created.status, 201);
  assert.ok(created.body.primary);

  const invalid = await call(cache.setCache, { body: { key: "" } });
  assert.equal(invalid.status, 400);
  assert.match(invalid.body.message, /required/);

  const read = await call(cache.getCache, { params: { key: "user:1" } });
  assert.equal(read.status, 200);
  assert.deepEqual(read.body.value, { name: "Ada" });
  assert.ok(read.body.expiresAt > Date.now());

  assert.equal((await call(cache.getCache, { params: { key: "user:1" }, query: { peek: "true" } })).status, 200);
  assert.equal((await call(cache.getCache, { params: { key: "missing" } })).status, 404);
  assert.equal((await call(cache.hasCache, { params: { key: "user:1" } })).body.exists, true);
  assert.equal((await call(cache.deleteCache, { params: { key: "user:1" } })).status, 200);
  assert.equal((await call(cache.deleteCache, { params: { key: "user:1" } })).status, 404);
});

test("health, keys, locate, ring and metrics endpoints respond", async () => {
  const { service } = makeCluster(ClusterService);
  const cache = createCacheController(service);
  const cluster = createClusterController(service);
  await call(cache.setCache, { body: { key: "a", value: 1 } });

  const health = await call(cache.health);
  assert.equal(health.status, 200);
  assert.equal(health.body.totalNodes, 3);

  const keys = await call(cache.listCacheKeys, { query: { q: "a", limit: "10" } });
  assert.equal(keys.body.keys.length, 1);

  const located = await call(cache.locateKey, { params: { key: "a" } });
  assert.equal(located.body.owners.length, 1);

  assert.equal((await call(cluster.ring)).body.nodes.length, 3);
  assert.equal((await call(cluster.metrics)).body.ops.set.count, 1);
});

test("cluster controller adds and removes nodes and maps failures to status codes", async () => {
  const { service, nodes } = makeCluster(ClusterService, { extra: 1 });
  const cluster = createClusterController(service);

  const missing = await call(cluster.addNode, { body: {} });
  assert.equal(missing.status, 400);

  const added = await call(cluster.addNode, { body: { url: nodes[3].url } });
  assert.equal(added.status, 201);
  assert.equal(added.body.nodes.length, 4);

  const duplicate = await call(cluster.addNode, { body: { url: nodes[3].url } });
  assert.equal(duplicate.status, 409);

  const removed = await call(cluster.removeNode, { query: { url: nodes[3].url } });
  assert.equal(removed.status, 200);
  assert.equal((await call(cluster.removeNode, { query: { url: nodes[3].url } })).status, 404);

  const rebalance = await call(cluster.rebalance);
  assert.equal(rebalance.status, 200);
  assert.equal(rebalance.body.rebalance.failed, 0);
});
