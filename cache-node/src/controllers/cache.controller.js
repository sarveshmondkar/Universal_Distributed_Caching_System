import { Cache } from "../cache/cache.js";

import fs from "node:fs";
import path from "node:path";

const capacity = Number(process.env.CACHE_CAPACITY || 10000);
const cache = new Cache(Number(process.env.CLEANUP_INTERVAL_MS || 5000), capacity, { maxValueBytes: Number(process.env.MAX_VALUE_BYTES || 1048576) });
const persistencePath = Object.hasOwn(process.env, "PERSISTENCE_FILE")
  ? process.env.PERSISTENCE_FILE
  : `./data/cache-${process.env.PORT || 4001}.json`;

if (persistencePath) {
  try { cache.restore(JSON.parse(fs.readFileSync(persistencePath, "utf8"))); }
  catch (error) { if (error.code !== "ENOENT") console.error(`Could not load cache snapshot: ${error.message}`); }
  const persist = () => {
    try {
      fs.mkdirSync(path.dirname(path.resolve(persistencePath)), { recursive: true });
      const temporary = `${persistencePath}.tmp`;
      fs.writeFileSync(temporary, JSON.stringify(cache.entries()), "utf8");
      fs.renameSync(temporary, persistencePath);
    } catch (error) { console.error(`Could not save cache snapshot: ${error.message}`); }
  };
  const timer = setInterval(persist, Number(process.env.PERSIST_INTERVAL_MS || 5000));
  timer.unref?.();
  process.on("SIGINT", () => { persist(); cache.close(); process.exit(0); });
  process.on("SIGTERM", () => { persist(); cache.close(); process.exit(0); });
}

export function setCache(req, res) {
  const { key, value, ttl } = req.body;

  if (typeof key !== "string" || !key.trim() || value === undefined) {
    return res.status(400).json({ message: "Key and value are required" });
  }

  try { cache.set(key, value, ttl); }
  catch (error) { return res.status(error instanceof RangeError ? 413 : 400).json({ message: error.message }); }

  return res.status(201).json({
    message: "Data stored successfully",
    key,
    value,
    ttl: ttl ?? null
  });
}

export function getCache(req, res) {
  const { key } = req.params;

  // ?peek=true inspects a key without touching LRU order or hit/miss counters,
  // so looking at a value in the dashboard never changes what the cache would evict.
  const peek = req.query.peek === "true";
  const entry = peek ? cache.peek(key) : cache.getEntry(key);

  if (entry === undefined) {
    return res.status(404).json({
      message: "key not found or expired",
    });
  }

  return res.json({
    key,
    value: entry.value,
    expiresAt: entry.expiresAt ?? null,
  });
}

export function deleteCache(req, res) {
  const { key } = req.params;

  const deleted = cache.delete(key);

  if (!deleted) {
    return res.status(404).json({
      message: "Key not found",
    });
  }

  return res.json({
    message: "Key deleted successfully",
  });
}

export function hasCache(req, res) {
  const { key } = req.params;
  return res.json({
    key,
    exists: cache.has(key),
  });
}

export function getCacheSize(req, res) {
  return res.json({
    size: cache.size(),
  });
}

export function debugCache(req, res) {
  // The full LRU order can be huge; return the first `limit` entries (least recently used first).
  const limit = Math.max(1, Math.min(500, Number(req.query.limit) || 50));
  const debug = cache.debug();
  return res.json({
    ...debug,
    order: debug.order.slice(0, limit).map(({ key, expiresAt }) => ({ key, expiresAt: expiresAt ?? null })),
    truncated: debug.order.length > limit,
  });
}

export function getCacheStats(req, res) {
    return res.json(cache.getStats());
}

export function listEntries(req, res) { return res.json({ entries: cache.entries() }); }

export function flushCache(req, res) {
  const removed = cache.clear();
  return res.json({ message: "Cache flushed", removed });
}

export function health(req, res) { return res.json({ status: "ok", role: "cache-node", size: cache.size(), capacity: cache.capacity }); }
export function listCacheKeys(req, res) { return res.json({ keys: cache.listKeys() }); }
