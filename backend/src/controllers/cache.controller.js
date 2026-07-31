import { Cache } from "../cache/cache.js";

const cache = new Cache(5000);

export function setCache(req, res) {
  const { key, value, ttl } = req.body;

  if (!key || value === undefined) {
    return res.status(400).json({ message: "Key and value are required" });
  }

  cache.set(key, value, ttl);

  return res.status(201).json({
    message: "Data stored successfully",
    key,
    value,
    ttl
  });
}

export function getCache(req, res) {
  const { key } = req.params;

  const value = cache.get(key);

  if (value === undefined) {
    return res.status(404).json({
      message: "key not found or expired",
    });
  }

  return res.json({
    key,
    value,
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
  return res.json(cache.debug());
}
