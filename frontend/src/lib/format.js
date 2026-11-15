const LOCAL = new Set(["localhost", "127.0.0.1", "[::1]"]);

export function nodeHost(url) {
  try { return new URL(url).host; } catch { return url; }
}

/** Short label for a node: ":4001" for localhost nodes, "cache1" for named hosts. */
export function nodeShort(url) {
  try {
    const parsed = new URL(url);
    return LOCAL.has(parsed.hostname) ? `:${parsed.port || "80"}` : parsed.hostname;
  } catch { return url; }
}

export const int = (value) => Number(value || 0).toLocaleString("en-US");

export function percent(fraction, digits = 1) {
  if (fraction === null || fraction === undefined || Number.isNaN(fraction)) return "n/a";
  return `${(fraction * 100).toFixed(digits)}%`;
}

export function formatExpiry(expiresAt, now = Date.now()) {
  if (expiresAt === null || expiresAt === undefined) return "No expiry";
  const left = Math.ceil((expiresAt - now) / 1000);
  if (left <= 0) return "Expired";
  if (left < 60) return `${left}s`;
  if (left < 3600) return `${Math.floor(left / 60)}m ${String(left % 60).padStart(2, "0")}s`;
  const hours = Math.floor(left / 3600);
  return `${hours}h ${String(Math.floor((left % 3600) / 60)).padStart(2, "0")}m`;
}

export function valuePreview(value, max = 72) {
  let text;
  try { text = JSON.stringify(value); } catch { text = String(value); }
  if (text === undefined) text = "undefined";
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

export function clock(ms) {
  return new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
}

export function duration(seconds) {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
  return `${Math.floor(seconds / 86400)}d`;
}

export const UNIT_MS = { seconds: 1000, minutes: 60_000, hours: 3_600_000 };

/** Turn "5" + "minutes" into milliseconds. Returns undefined for blank, NaN for invalid. */
export function ttlMs(amount, unit) {
  const text = String(amount ?? "").trim();
  if (!text) return undefined;
  const number = Number(text);
  if (!Number.isFinite(number) || number <= 0) return Number.NaN;
  return Math.round(number * UNIT_MS[unit]);
}

export function curlFor({ method, path, body }) {
  const origin = typeof window === "undefined" ? "http://localhost:3000" : window.location.origin;
  const parts = [`curl -s${method === "GET" ? "" : ` -X ${method}`} '${origin}${path}'`];
  if (body !== undefined) parts.push(`-H 'Content-Type: application/json' -d '${JSON.stringify(body)}'`);
  return parts.join(" \\\n  ");
}

export function parseJson(text) {
  try { return { ok: true, value: JSON.parse(text) }; }
  catch (error) { return { ok: false, message: error.message }; }
}
