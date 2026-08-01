import { Cache } from "../cache/cache.js";

test("key expires after ttl", async () => {
  const cache = new Cache(50);

  cache.set("otp", "1234", 100);

  await new Promise(resolve => setTimeout(resolve, 150));

  expect(cache.get("otp")).toBeUndefined();
});


test("key without ttl never expires", async () => {
  const cache = new Cache(50);

  cache.set("name", "Sarvesh");

  await new Promise(resolve => setTimeout(resolve, 200));

  expect(cache.get("name")).toBe("Sarvesh");
});


test("expired key is removed from cache", async () => {
  const cache = new Cache(50);

  cache.set("otp", "1234", 100);

  await new Promise(resolve => setTimeout(resolve, 150));

  cache.get("otp");

  expect(cache.size()).toBe(0);
});


test("has returns false for expired key", async () => {
  const cache = new Cache(50);

  cache.set("otp", "1234", 100);

  await new Promise(resolve => setTimeout(resolve, 150));

  expect(cache.has("otp")).toBe(false);
});


test("background cleanup removes expired key", async () => {
  const cache = new Cache(50);

  cache.set("otp", "1234", 100);

  await new Promise(resolve => setTimeout(resolve, 300));

  expect(cache.size()).toBe(0);
});


test("updating key resets ttl", async () => {
  const cache = new Cache(50);

  cache.set("A", 10, 100);

  await new Promise(resolve => setTimeout(resolve, 50));

  cache.set("A", 20, 500);

  await new Promise(resolve => setTimeout(resolve, 100));

  expect(cache.get("A")).toBe(20);
});