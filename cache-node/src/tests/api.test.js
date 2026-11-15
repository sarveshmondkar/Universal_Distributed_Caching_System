import app from "../app.js";

let server;
let baseUrl;

beforeAll(async () => {
  server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

afterAll(async () => {
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
});

test("HTTP API stores, reads, checks, deletes, and reports health", async () => {
  const key = "api:test key";
  const saved = await fetch(`${baseUrl}/cache`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ key, value: { ok: true } }) });
  expect(saved.status).toBe(201);
  expect((await saved.json()).value).toEqual({ ok: true });

  const read = await fetch(`${baseUrl}/cache/${encodeURIComponent(key)}`);
  expect(read.status).toBe(200);
  expect((await read.json()).value).toEqual({ ok: true });

  expect((await (await fetch(`${baseUrl}/cache/has/${encodeURIComponent(key)}`)).json()).exists).toBe(true);
  expect((await fetch(`${baseUrl}/health`)).status).toBe(200);
  expect((await fetch(`${baseUrl}/cache/delete/${encodeURIComponent(key)}`, { method: "DELETE" })).status).toBe(200);
  expect((await fetch(`${baseUrl}/cache/${encodeURIComponent(key)}`)).status).toBe(404);
});

test("HTTP API rejects invalid keys and missing values", async () => {
  const response = await fetch(`${baseUrl}/cache`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ key: "" }) });
  expect(response.status).toBe(400);
});

test("HTTP API peeks without counting a read, lists entries, and flushes", async () => {
  const key = "api:peek";
  await fetch(`${baseUrl}/cache`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ key, value: 1, ttl: 60000 }) });

  const before = await (await fetch(`${baseUrl}/cache/stats`)).json();
  const peeked = await fetch(`${baseUrl}/cache/${encodeURIComponent(key)}?peek=true`);
  expect(peeked.status).toBe(200);
  const body = await peeked.json();
  expect(body.value).toBe(1);
  expect(typeof body.expiresAt).toBe("number");
  const after = await (await fetch(`${baseUrl}/cache/stats`)).json();
  expect(after.totalRequests).toBe(before.totalRequests);

  const entries = await (await fetch(`${baseUrl}/cache/entries`)).json();
  expect(entries.entries.some((entry) => entry.key === key)).toBe(true);

  const flushed = await fetch(`${baseUrl}/cache`, { method: "DELETE" });
  expect(flushed.status).toBe(200);
  expect((await fetch(`${baseUrl}/cache/${encodeURIComponent(key)}`)).status).toBe(404);
});
