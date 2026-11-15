export class ApiError extends Error {
  constructor(message, status, data) {
    super(message);
    this.status = status;
    this.data = data;
  }
}

/**
 * Make one request and describe what happened. Never throws: a network failure comes back as
 * status 0. Used directly where the status itself is interesting (the console, health checks).
 */
export async function call(path, { method = "GET", body } = {}) {
  const started = performance.now();
  try {
    const response = await fetch(path, {
      method,
      headers: body === undefined ? undefined : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = await response.json().catch(() => ({}));
    return { ok: response.ok, status: response.status, data, ms: performance.now() - started, method, path, body };
  } catch {
    return {
      ok: false, status: 0, ms: performance.now() - started, method, path, body,
      data: { message: "The router did not respond." },
    };
  }
}

/** Like `call`, but throws an ApiError for any non-2xx response. */
export async function api(path, options) {
  const result = await call(path, options);
  if (!result.ok) throw new ApiError(result.data?.message || `Request failed (${result.status})`, result.status, result.data);
  return result.data;
}

export const enc = encodeURIComponent;
