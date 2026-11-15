import test from "node:test";
import assert from "node:assert/strict";
import { NodeSelector } from "../services/nodeSelector.js";
import { planRebalance } from "../services/rebalance.js";

const NOW = 1_000_000;

test("copies a key to the owners that are missing it", () => {
  const selector = new NodeSelector(["a", "b", "c"], 30);
  const [primary, replica] = selector.ordered("k");
  const holdings = new Map([[primary, [{ key: "k", value: 1 }]]]);
  const plan = planRebalance({ holdings, selector, replicationFactor: 2, now: NOW });
  assert.deepEqual(plan.copies.map((copy) => copy.node), [replica]);
  assert.equal(plan.deletes.length, 0);
});

test("deletes copies held by nodes that no longer own the key", () => {
  const selector = new NodeSelector(["a", "b", "c"], 30);
  const [primary, , outsider] = selector.ordered("k");
  const holdings = new Map([[primary, [{ key: "k", value: 1 }]], [outsider, [{ key: "k", value: 1 }]]]);
  const plan = planRebalance({ holdings, selector, replicationFactor: 1, now: NOW });
  assert.deepEqual(plan.deletes, [{ node: outsider, key: "k" }]);
  assert.equal(plan.copies.length, 0);
});

test("never deletes from a leaving node but still reads from it", () => {
  const selector = new NodeSelector(["a", "b"], 30);
  const holdings = new Map([["gone", [{ key: "k", value: 7 }]]]);
  const plan = planRebalance({ holdings, selector, replicationFactor: 1, leaving: ["gone"], now: NOW });
  assert.equal(plan.copies.length, 1);
  assert.equal(plan.copies[0].value, 7);
  assert.equal(plan.copies[0].from, "gone");
  assert.equal(plan.deletes.length, 0);
});

test("skips expired entries and carries over the remaining ttl", () => {
  const selector = new NodeSelector(["a", "b"], 30);
  const holdings = new Map([["gone", [
    { key: "old", value: 1, expiresAt: NOW - 1 },
    { key: "fresh", value: 2, expiresAt: NOW + 5_000 },
    { key: "forever", value: 3 },
  ]]]);
  const plan = planRebalance({ holdings, selector, replicationFactor: 1, leaving: ["gone"], now: NOW });
  assert.equal(plan.scanned, 2);
  const byKey = Object.fromEntries(plan.copies.map((copy) => [copy.key, copy]));
  assert.equal(byKey.fresh.ttl, 5_000);
  assert.equal(byKey.forever.ttl, undefined);
  assert.equal(byKey.old, undefined);
});

test("is a no-op when every key already sits on its owners", () => {
  const selector = new NodeSelector(["a", "b", "c"], 30);
  const holdings = new Map([["a", []], ["b", []], ["c", []]]);
  for (let i = 0; i < 100; i++) {
    const key = `k${i}`;
    const owner = selector.ordered(key)[0];
    holdings.get(owner).push({ key, value: i });
  }
  const plan = planRebalance({ holdings, selector, replicationFactor: 1, now: NOW });
  assert.equal(plan.copies.length + plan.deletes.length, 0);
  assert.equal(plan.scanned, 100);
});

test("when replicas disagree, the copy on the earliest ring owner wins", () => {
  const selector = new NodeSelector(["a", "b", "c"], 30);
  const [first, second, third] = selector.ordered("k");
  const holdings = new Map([[second, [{ key: "k", value: "second" }]], [first, [{ key: "k", value: "first" }]]]);
  const plan = planRebalance({ holdings, selector, replicationFactor: 3, now: NOW });
  assert.deepEqual(plan.copies.map((copy) => [copy.node, copy.value]), [[third, "first"]]);
});
