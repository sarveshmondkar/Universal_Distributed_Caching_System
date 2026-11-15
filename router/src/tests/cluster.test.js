import test from "node:test";
import assert from "node:assert/strict";
import { ClusterService, ClusterError } from "../services/cluster.js";
import { makeCluster } from "./helpers.js";

const holders = (nodes, key) => nodes.filter((node) => node.store.has(key)).map((node) => node.url);

test("set writes to the primary and replicas and reports both", async () => {
  const { service, nodes } = makeCluster(ClusterService, { replicationFactor: 2 });
  const { status, body } = await service.set({ key: "user:1", value: { a: 1 } });
  assert.equal(status, 201);
  const owners = service.selector.ordered("user:1").slice(0, 2);
  assert.equal(body.primary, owners[0]);
  assert.deepEqual(body.replicas, [{ node: owners[1], healthy: true }]);
  assert.deepEqual(holders(nodes, "user:1").sort(), [...owners].sort());
});

test("set rejects a missing key or value", async () => {
  const { service } = makeCluster(ClusterService);
  await assert.rejects(() => service.set({ key: "", value: 1 }), (error) => error instanceof ClusterError && error.status === 400);
  await assert.rejects(() => service.set({ key: "k" }), (error) => error.status === 400);
});

test("get returns the value and the node that served it", async () => {
  const { service } = makeCluster(ClusterService);
  await service.set({ key: "k", value: "v" });
  const { status, body } = await service.get("k");
  assert.equal(status, 200);
  assert.equal(body.value, "v");
  assert.equal(body.servedBy, service.selector.ordered("k")[0]);
});

test("a miss only consults replicationFactor nodes, not the whole cluster", async () => {
  const { service, nodes } = makeCluster(ClusterService, { count: 4, replicationFactor: 2 });
  const { status } = await service.get("never-stored");
  assert.equal(status, 404);
  assert.equal(nodes.reduce((sum, node) => sum + node.calls.get, 0), 2);
});

test("writes fail over to the next node when the primary is down, and reads find them", async () => {
  const { service, byUrl } = makeCluster(ClusterService);
  const primary = service.selector.ordered("k")[0];
  byUrl[primary].down = true;
  const { body } = await service.set({ key: "k", value: 1 });
  assert.notEqual(body.primary, primary);
  const read = await service.get("k");
  assert.equal(read.status, 200);
  assert.equal(read.body.servedBy, body.primary);
});

test("repeated failures mark a node down so later requests skip it", async () => {
  const { service, byUrl } = makeCluster(ClusterService);
  const primary = service.selector.ordered("k")[0];
  byUrl[primary].down = true;
  await service.set({ key: "k", value: 1 });
  await service.get("k");
  assert.equal(service.isUp(primary), false);
  const callsBefore = byUrl[primary].calls.post;
  await service.set({ key: "k", value: 2 });
  assert.equal(byUrl[primary].calls.post, callsBefore);
});

test("a miss on a key owned by a down node is reported as incomplete, not as not found", async () => {
  const { service, byUrl } = makeCluster(ClusterService);
  const primary = service.selector.ordered("ghost")[0];
  byUrl[primary].down = true;
  await service.checkHealth();
  const { status, body } = await service.get("ghost");
  assert.equal(status, 503);
  assert.match(body.message, /incomplete/);
});

test("read repair restores a replica that lost its copy", async () => {
  const { service, byUrl } = makeCluster(ClusterService, { replicationFactor: 2 });
  await service.set({ key: "k", value: "v", ttl: 60_000 });
  const [primary, replica] = service.selector.ordered("k");
  byUrl[primary].store.delete("k");

  const read = await service.get("k");
  assert.equal(read.body.servedBy, replica);
  await service.idle();

  assert.equal(byUrl[primary].store.get("k").value, "v");
  assert.ok(byUrl[primary].store.get("k").expiresAt > Date.now(), "repair keeps the remaining ttl");
  assert.equal(service.metrics.snapshot().counters.readRepairs, 1);
});

test("peek reads do not trigger read repair or count as reads", async () => {
  const { service, byUrl } = makeCluster(ClusterService, { replicationFactor: 2 });
  await service.set({ key: "k", value: "v" });
  const [primary] = service.selector.ordered("k");
  byUrl[primary].store.delete("k");

  const read = await service.get("k", { peek: true });
  assert.equal(read.status, 200);
  await service.idle();
  assert.equal(byUrl[primary].store.has("k"), false);
  assert.equal(service.metrics.snapshot().reads.count, 0);
  assert.ok(Object.values(byUrl).some((node) => node.calls.peek > 0));
});

test("delete removes every copy", async () => {
  const { service, nodes } = makeCluster(ClusterService, { replicationFactor: 3 });
  await service.set({ key: "k", value: 1 });
  assert.equal(holders(nodes, "k").length, 3);
  const { status } = await service.delete("k");
  assert.equal(status, 200);
  assert.equal(holders(nodes, "k").length, 0);
  assert.equal((await service.delete("k")).status, 404);
});

test("replication factor is clamped to the node count", () => {
  const { service } = makeCluster(ClusterService, { count: 2, replicationFactor: 5 });
  assert.equal(service.replicationFactor, 2);
});

test("locate explains primary, replica and standby roles", () => {
  const { service } = makeCluster(ClusterService, { count: 4, replicationFactor: 2 });
  const { body } = service.locate("user:42");
  assert.deepEqual(body.walk.map((entry) => entry.role), ["primary", "replica", "standby", "standby"]);
  assert.equal(body.owners.length, 2);
  assert.ok(body.position >= 0 && body.position < 1);
  assert.equal(body.hash.length, 64);
});

test("listKeys merges replicas, attaches ring data, filters and limits", async () => {
  const { service, byUrl } = makeCluster(ClusterService, { replicationFactor: 2 });
  for (let i = 0; i < 20; i++) await service.set({ key: `user:${i}`, value: i });
  await service.set({ key: "order:1", value: 1 });
  const all = (await service.listKeys()).body;
  assert.equal(all.total, 21);
  assert.equal(all.keys[0].nodes.length, 2);
  assert.equal(all.keys[0].owners.length, 2);
  assert.equal(all.keys[0].underReplicated, false);
  assert.ok(all.keys[0].position >= 0 && all.keys[0].position < 1);

  const filtered = (await service.listKeys({ q: "ORDER" })).body;
  assert.equal(filtered.matched, 1);
  assert.equal((await service.listKeys({ limit: 5 })).body.keys.length, 5);

  const owner = service.selector.ordered("order:1")[1];
  byUrl[owner].store.delete("order:1");
  const flagged = (await service.listKeys({ q: "order" })).body.keys[0];
  assert.equal(flagged.underReplicated, true);
});

test("checkHealth reports each node and recovers a node that comes back", async () => {
  const { service, nodes } = makeCluster(ClusterService);
  nodes[1].down = true;
  const down = await service.checkHealth();
  assert.equal(down.status, 200);
  assert.equal(down.body.healthyNodes, 2);
  assert.equal(service.isUp(nodes[1].url), false);

  nodes[1].down = false;
  const up = await service.checkHealth();
  assert.equal(up.body.healthyNodes, 3);
  assert.equal(service.isUp(nodes[1].url), true);

  nodes.forEach((node) => { node.down = true; });
  assert.equal((await service.checkHealth()).status, 503);
});

test("flush empties every node", async () => {
  const { service, nodes } = makeCluster(ClusterService);
  for (let i = 0; i < 10; i++) await service.set({ key: `k${i}`, value: i });
  const { body } = await service.flush();
  assert.equal(body.removed, 10);
  assert.equal(nodes.reduce((sum, node) => sum + node.store.size, 0), 0);
});

/* ------------------------------ membership changes ------------------------------ */

async function seed(service, count) {
  for (let i = 0; i < count; i++) await service.set({ key: `key:${i}`, value: i });
}

test("adding a node moves only the keys it now owns, and loses nothing", async () => {
  const { service, nodes, byUrl } = makeCluster(ClusterService, { extra: 1 });
  await seed(service, 300);
  const newcomer = nodes[3];

  const { status, body } = await service.addNode(newcomer.url);
  assert.equal(status, 201);
  assert.equal(service.nodes.length, 4);
  assert.ok(body.rebalance.copied > 0, "some keys should move to the new node");
  assert.ok(body.rebalance.copied < 300 * 0.5, "far fewer than half the keys should move");
  assert.equal(body.rebalance.copied, body.rebalance.removed);
  assert.equal(body.rebalance.failed, 0);

  for (let i = 0; i < 300; i++) {
    const key = `key:${i}`;
    assert.deepEqual(holders(Object.values(byUrl), key), [service.selector.ordered(key)[0]], `${key} should live only on its owner`);
    assert.equal((await service.get(key)).body.value, i);
  }
  assert.equal(newcomer.store.size, body.rebalance.copied);
});

test("adding a node to a replicated cluster keeps the right number of copies", async () => {
  const { service, nodes } = makeCluster(ClusterService, { replicationFactor: 2, extra: 1 });
  await seed(service, 100);
  await service.addNode(nodes[3].url);
  for (let i = 0; i < 100; i++) {
    const key = `key:${i}`;
    assert.deepEqual(holders(nodes, key).sort(), service.selector.ordered(key).slice(0, 2).sort());
  }
});

test("addNode refuses a node that is already a member, malformed, or unreachable", async () => {
  const { service, nodes } = makeCluster(ClusterService, { extra: 1 });
  await assert.rejects(() => service.addNode(nodes[0].url), (error) => error.status === 409);
  await assert.rejects(() => service.addNode("not a url"), (error) => error.status === 400);
  nodes[3].down = true;
  await assert.rejects(() => service.addNode(nodes[3].url), (error) => error.status === 502);
  assert.equal(service.nodes.length, 3);
  assert.equal(service.health.has(nodes[3].url), false);
});

test("removing a node drains its keys to the remaining owners", async () => {
  const { service, nodes } = makeCluster(ClusterService);
  await seed(service, 200);
  const leaving = nodes[1];
  const had = leaving.store.size;
  assert.ok(had > 0);

  const { body } = await service.removeNode(leaving.url);
  assert.equal(service.nodes.length, 2);
  assert.equal(body.rebalance.copied, had);
  assert.equal(body.rebalance.failed, 0);
  assert.equal(service.health.has(leaving.url), false);
  for (let i = 0; i < 200; i++) assert.equal((await service.get(`key:${i}`)).body.value, i);
});

test("removing the last node, or an unknown node, is refused", async () => {
  const { service, nodes } = makeCluster(ClusterService, { count: 1 });
  await assert.rejects(() => service.removeNode(nodes[0].url), (error) => error.status === 409);
  await assert.rejects(() => service.removeNode("http://elsewhere:1"), (error) => error.status === 404);
});

test("rebalance never deletes a surplus copy if the new copy could not be written", async () => {
  const { service, nodes } = makeCluster(ClusterService, { extra: 1 });
  await seed(service, 200);
  service._setNodes([...service.nodes, nodes[3].url]);
  nodes[3].down = true; // the new owner rejects every write

  const summary = await service.rebalance();
  assert.ok(summary.failed > 0);
  for (let i = 0; i < 200; i++) {
    assert.ok(holders(nodes, `key:${i}`).length >= 1, `key:${i} was lost`);
  }
});

test("rebalance skips unreachable nodes and reports them", async () => {
  const { service, nodes } = makeCluster(ClusterService);
  await seed(service, 20);
  nodes[2].down = true;
  const summary = await service.rebalance();
  assert.deepEqual(summary.unreachable, [nodes[2].url]);
});

test("ringVersion changes whenever membership changes", async () => {
  const { service, nodes } = makeCluster(ClusterService, { extra: 1 });
  const before = service.ringVersion;
  await service.addNode(nodes[3].url);
  assert.ok(service.ringVersion > before);
});
