import test from "node:test";
import assert from "node:assert/strict";
import { Metrics } from "../services/metrics.js";

test("computes hit rate from client-facing reads", () => {
  const metrics = new Metrics();
  metrics.record({ op: "get", key: "a", status: 200, ms: 2, outcome: "hit" });
  metrics.record({ op: "get", key: "b", status: 200, ms: 3, outcome: "hit" });
  metrics.record({ op: "get", key: "c", status: 404, ms: 4, outcome: "miss" });
  metrics.record({ op: "set", key: "a", status: 201, ms: 5, outcome: "ok" });
  const snapshot = metrics.snapshot();
  assert.equal(snapshot.reads.count, 3);
  assert.ok(Math.abs(snapshot.reads.hitRate - 2 / 3) < 1e-9);
  assert.equal(snapshot.ops.set.count, 1);
  assert.equal(snapshot.totals.requests, 4);
});

test("hit rate is null before any read", () => {
  assert.equal(new Metrics().snapshot().reads.hitRate, null);
});

test("reports latency percentiles", () => {
  const metrics = new Metrics();
  for (let ms = 1; ms <= 100; ms++) metrics.record({ op: "get", key: "k", status: 200, ms, outcome: "hit" });
  const { p50, p95, p99 } = metrics.snapshot().ops.get;
  assert.equal(p50, 50);
  assert.equal(p95, 95);
  assert.equal(p99, 99);
});

test("keeps only the most recent events, newest first", () => {
  const metrics = new Metrics({ maxEvents: 3 });
  for (let i = 0; i < 5; i++) metrics.record({ op: "get", key: `k${i}`, status: 200, ms: 1, outcome: "hit" });
  assert.deepEqual(metrics.snapshot().recent.map((event) => event.key), ["k4", "k3", "k2"]);
});

test("bounds latency samples", () => {
  const metrics = new Metrics({ maxSamples: 10 });
  for (let i = 0; i < 100; i++) metrics.record({ op: "get", key: "k", status: 200, ms: i, outcome: "hit" });
  assert.equal(metrics._op("get").samples.length, 10);
  assert.equal(metrics.snapshot().ops.get.count, 100);
});

test("requests per second reflects the last ten seconds only", () => {
  let clock = 1_000_000;
  const metrics = new Metrics({ now: () => clock });
  for (let i = 0; i < 50; i++) metrics.record({ op: "get", key: "k", status: 200, ms: 1, outcome: "hit" });
  assert.equal(metrics.snapshot().requestsPerSecond, 5);
  clock += 30_000;
  assert.equal(metrics.snapshot().requestsPerSecond, 0);
});

test("counts internal events", () => {
  const metrics = new Metrics();
  metrics.increment("readRepairs");
  metrics.increment("readRepairs", 2);
  assert.equal(metrics.snapshot().counters.readRepairs, 3);
});
