import { Cache } from "../cache/cache.js";

test("increments hits", () => {
  const cache = new Cache();

  cache.set("A", 10);

  cache.get("A");

  expect(cache.getStats().hits).toBe(1);
});


test("increments misses", () => {
  const cache = new Cache();

  cache.get("A");

  expect(cache.getStats().misses).toBe(1);
});


test("increments eviction counter", () => {
  const cache = new Cache(5000, 2);

  cache.set("A", 10);
  cache.set("B", 20);
  cache.set("C", 30);

  expect(cache.getStats().evictions).toBe(1);
});


test("increments expired counter", async () => {
  const cache = new Cache(50);

  cache.set("otp", "1234", 100);

  await new Promise(r => setTimeout(r, 150));

  cache.get("otp");

  expect(cache.getStats().expiredKeys).toBe(1);
});


test("calculates hit ratio", () => {
  const cache = new Cache();

  cache.set("A", 10);

  cache.get("A");
  cache.get("A");
  cache.get("B");

  expect(cache.getStats().hitRatio).toBe("66.67%");
});
