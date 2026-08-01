import { Cache } from "../cache/cache.js";

test("evicts least recently used key when cache is full", () => {
  const cache = new Cache(5000, 3);

  cache.set("A", 10);
  cache.set("B", 20);
  cache.set("C", 30);

  cache.set("D", 40);

  expect(cache.has("A")).toBe(false);
  expect(cache.has("B")).toBe(true);
  expect(cache.has("C")).toBe(true);
  expect(cache.has("D")).toBe(true);

  expect(cache.size()).toBe(3);
});


test("get() moves key to most recently used position", () => {
  const cache = new Cache(5000, 3);

  cache.set("A", 10);
  cache.set("B", 20);
  cache.set("C", 30);

  cache.get("A");

  cache.set("D", 40);

  expect(cache.has("A")).toBe(true);
  expect(cache.has("B")).toBe(false);
  expect(cache.has("C")).toBe(true);
  expect(cache.has("D")).toBe(true);
});


test("updating existing key makes it recently used", () => {
  const cache = new Cache(5000, 3);

  cache.set("A", 10);
  cache.set("B", 20);
  cache.set("C", 30);

  cache.set("A", 100);

  cache.set("D", 40);

  expect(cache.has("A")).toBe(true);
  expect(cache.get("A")).toBe(100);

  expect(cache.has("B")).toBe(false);
});


test("cache never exceeds capacity", () => {
  const cache = new Cache(5000, 2);

  cache.set("A", 10);
  cache.set("B", 20);
  cache.set("C", 30);

  expect(cache.size()).toBe(2);
});


test("debug returns correct LRU order", () => {
  const cache = new Cache(5000, 3);

  cache.set("A", 10);
  cache.set("B", 20);
  cache.set("C", 30);

  cache.get("A");

  const debug = cache.debug();

  expect(debug.head).toBe("B");
  expect(debug.tail).toBe("A");

  expect(debug.order.map(item => item.key)).toEqual([
    "B",
    "C",
    "A",
  ]);
});