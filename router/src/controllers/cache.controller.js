import axios from "axios";

const CACHE_NODE = process.env.CACHE_NODE || "http://localhost:4001";

async function forwardRequest(req, res, axiosRequest) {
  try {
    const response = await axiosRequest();

    return res.status(response.status).json(response.data);
  } catch (error) {
    if (error.response) {
      return res.status(error.response.status).json(error.response.data);
    }

    return res.status(500).json({
      message: "Unable to connect to cache node",
    });
  }
}

export async function setCache(req, res) {
  return forwardRequest(req, res, () =>
    axios.post(`${CACHE_NODE}/cache`, req.body),
  );
}

export async function getCache(req, res) {
  const { key } = req.params;
  return forwardRequest(req, res, () =>
    axios.get(`${CACHE_NODE}/cache/${key}`),
  );
}

export async function hasCache(req, res) {
  const { key } = req.params;
  return forwardRequest(req, res, () =>
    axios.get(`${CACHE_NODE}/cache/has/${key}`),
  );
}

export async function deleteCache(req, res) {
  const { key } = req.params;
  return forwardRequest(req, res, () =>
    axios.delete(`${CACHE_NODE}/cache/delete/${key}`),
  );
}

export async function getCacheSize(req, res) {
  return forwardRequest(req, res, () =>
    axios.get(`${CACHE_NODE}/cache/cache-size`),
  );
}

export async function debugCache(req, res) {
  return forwardRequest(req, res, () => axios.get(`${CACHE_NODE}/cache/debug`));
}

export async function getCacheStats(req, res) {
  return forwardRequest(req, res, () => axios.get(`${CACHE_NODE}/cache/stats`));
}
