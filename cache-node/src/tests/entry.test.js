import { Cache } from "../cache/cache.js";

test("getEntry returns the value together with its expiry", () => {
  const cache = new Cache();
  cache.set("a", { n: 1 }, 60_000);
  const entry = cache.getEntry("a");
  expect(entry.value).toEqual({ n: 1 });
  expect(entry.expiresAt).toBeGreaterThan(Date.now());
  cache.close();
});

test("getEntry leaves expiresAt undefined for keys without a TTL", () => {
  const cache = new Cache();
  cache.set("a", 1);
  expect(cache.getEntry("a").expiresAt).toBeUndefined();
  cache.close();
});

test("peek does not change LRU order or hit/miss counters", () => {
  const cache = new Cache(5000, 3);
  cache.set("A", 1);
  cache.set("B", 2);
  cache.set("C", 3);

  expect(cache.peek("A").value).toBe(1);
  expect(cache.peek("missing")).toBeUndefined();

  expect(cache.debug().head).toBe("A");
  expect(cache.getStats().totalRequests).toBe(0);
  cache.close();
});

test("peek ignores expired keys", async () => {
  const cache = new Cache(5000);
  cache.set("otp", "1234", 20);
  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(cache.peek("otp")).toBeUndefined();
  cache.close();
});

test("clear removes every key but keeps counters", () => {
  const cache = new Cache();
  cache.set("A", 1);
  cache.set("B", 2);
  cache.get("A");

  expect(cache.clear()).toBe(2);
  expect(cache.size()).toBe(0);
  expect(cache.getStats().hits).toBe(1);

  cache.set("C", 3);
  expect(cache.debug().order.map((item) => item.key)).toEqual(["C"]);
  cache.close();
});

test("counts writes and deletes, but not restored snapshot entries", () => {
  const cache = new Cache();
  cache.restore([{ key: "restored", value: 1 }]);
  expect(cache.getStats().sets).toBe(0);

  cache.set("A", 1);
  cache.set("A", 2);
  cache.delete("A");
  cache.delete("A");

  const stats = cache.getStats();
  expect(stats.sets).toBe(2);
  expect(stats.deletes).toBe(1);
  cache.close();
});

test("treats a null ttl as no expiry", () => {
  const cache = new Cache();
  cache.set("A", 1, null);
  expect(cache.getEntry("A").expiresAt).toBeUndefined();
  cache.close();
});
