import { Cache } from "../cache/cache.js";

const cache = new Cache(5000);

export function setCache(req, res) {
  const { key, value, ttl } = req.body;

  if (!key || value === undefined) {
    return res.status(400).json({ message: "Key and value are required" });
  }

  const dataObj = {
    value,
  };

  if (ttl !== undefined) {
    dataObj.ttl = ttl;
  }

  cache.set(key, dataObj);

  return res.status(201).json({
    message: "Data stored successfully",
    key,
    data: dataObj,
  });
}

export function getCache(req, res) {
  const { key } = req.params;

  const value = cache.get(key);

  if(value===undefined){
    return res.status(404).json({
      message: "key not found or expired"
    })
  }

  return res.json({
    key,
    value,
  });
}

export function deleteCache(req, res) {
  const { key } = req.params;

  if (!cache.has(key)) {
    return res.status(404).json({
      message: "Key not found",
    });
  }
  cache.delete(key);

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
