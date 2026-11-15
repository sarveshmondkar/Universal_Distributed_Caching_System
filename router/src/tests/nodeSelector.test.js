import test from "node:test";
import assert from "node:assert/strict";
import { NodeSelector } from "../services/nodeSelector.js";

test("maps a key to one stable primary and ordered replicas", () => {
  const selector = new NodeSelector(["http://a", "http://b", "http://c"], 30);
  const first = selector.ordered("customer:7");
  assert.deepEqual(selector.ordered("customer:7"), first);
  assert.equal(new Set(first).size, 3);
});

test("adding a node preserves most existing primary placements", () => {
  const before = new NodeSelector(["a", "b", "c"], 100);
  const after = new NodeSelector(["a", "b", "c", "d"], 100);
  let unchanged = 0;
  for (let i = 0; i < 1000; i++) if (before.ordered(`key-${i}`)[0] === after.ordered(`key-${i}`)[0]) unchanged++;
  assert.ok(unchanged > 600, `expected consistent hashing to retain most keys; retained ${unchanged}`);
});

test("a key that moves after adding a node moves to the new node", () => {
  const before = new NodeSelector(["a", "b", "c"], 100);
  const after = new NodeSelector(["a", "b", "c", "d"], 100);
  for (let i = 0; i < 500; i++) {
    const key = `key-${i}`;
    const old = before.ordered(key)[0];
    const next = after.ordered(key)[0];
    if (old !== next) assert.equal(next, "d");
  }
});

test("locate returns a ring position in [0, 1) and a 64 character hash", () => {
  const selector = new NodeSelector(["a", "b"], 10);
  for (let i = 0; i < 50; i++) {
    const { hash, position } = selector.locate(`k${i}`);
    assert.equal(hash.length, 64);
    assert.ok(position >= 0 && position < 1);
  }
});

test("walk lists each node once, starting with the primary", () => {
  const selector = new NodeSelector(["a", "b", "c"], 20);
  const walk = selector.walk("user:1");
  assert.equal(walk.length, 3);
  assert.equal(new Set(walk.map((entry) => entry.node)).size, 3);
  assert.equal(walk[0].node, selector.ordered("user:1")[0]);
});

test("the primary owner is the first token at or after the key's position, wrapping around", () => {
  const selector = new NodeSelector(["a", "b", "c"], 20);
  for (let i = 0; i < 200; i++) {
    const key = `probe-${i}`;
    const { position } = selector.locate(key);
    const clockwise = selector.ring.find((entry) => entry.position >= position) ?? selector.ring[0];
    assert.equal(selector.ordered(key)[0], clockwise.node);
  }
});

test("snapshot reports every token and ring shares that sum to one", () => {
  const selector = new NodeSelector(["a", "b", "c"], 40);
  const snapshot = selector.snapshot();
  assert.equal(snapshot.tokenCount, 120);
  assert.equal(snapshot.nodes.reduce((sum, node) => sum + node.tokens.length, 0), 120);
  const total = snapshot.nodes.reduce((sum, node) => sum + node.share, 0);
  assert.ok(Math.abs(total - 1) < 0.001, `shares summed to ${total}`);
  for (const node of snapshot.nodes) assert.ok(node.share > 0.1 && node.share < 0.6, `unbalanced share ${node.share}`);
});

test("an empty ring has no owners", () => {
  const selector = new NodeSelector([], 10);
  assert.deepEqual(selector.ordered("x"), []);
});
