import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { call } from "../api.js";

const POLL_MS = 5000;
const HISTORY = 30;
const KEY_LIMIT = 1500;

/**
 * Polls the router and combines health, per-node stats, key metadata, request metrics and the
 * ring geometry into one object the views can read.
 */
export function useCluster() {
  const [snapshot, setSnapshot] = useState({
    loaded: false, reachable: true, health: null, stats: [], keys: { keys: [], total: 0, matched: 0 },
    metrics: null, ring: null, updatedAt: null,
  });
  const [history, setHistory] = useState([]);
  const [refreshing, setRefreshing] = useState(false);
  const busy = useRef(false);
  const ringVersion = useRef(null);
  const previous = useRef(null);

  const refresh = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    setRefreshing(true);
    const [health, stats, keys, metrics] = await Promise.all([
      call("/cache/health"), call("/cache/stats"), call(`/cache/keys?limit=${KEY_LIMIT}`), call("/cluster/metrics"),
    ]);
    const reachable = [health, stats, keys, metrics].some((result) => result.status !== 0);

    let ring;
    const version = health.data?.ringVersion;
    if (reachable && version !== undefined && version !== ringVersion.current) {
      const result = await call("/cluster/ring");
      if (result.ok) { ring = result.data; ringVersion.current = version; }
    }

    if (metrics.ok) {
      const get = metrics.data.ops?.get || {};
      const point = { at: Date.now(), hits: get.hits || 0, misses: get.misses || 0, writes: metrics.data.ops?.set?.count || 0 };
      const last = previous.current;
      if (last && point.hits >= last.hits && point.misses >= last.misses) {
        setHistory((old) => [...old, {
          at: point.at, hits: point.hits - last.hits, misses: point.misses - last.misses, writes: Math.max(0, point.writes - last.writes),
        }].slice(-HISTORY));
      }
      previous.current = point;
    }

    setSnapshot((old) => ({
      loaded: true,
      reachable,
      health: health.status !== 0 && health.data?.nodes ? health.data : (reachable ? old.health : null),
      stats: stats.ok ? stats.data.nodes || [] : (reachable ? old.stats : []),
      keys: keys.ok ? keys.data : old.keys,
      metrics: metrics.ok ? metrics.data : old.metrics,
      ring: ring ?? old.ring,
      updatedAt: Date.now(),
    }));
    busy.current = false;
    setRefreshing(false);
  }, []);

  useEffect(() => {
    refresh();
    const timer = setInterval(() => { if (!document.hidden) refresh(); }, POLL_MS);
    const onVisible = () => { if (!document.hidden) refresh(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => { clearInterval(timer); document.removeEventListener("visibilitychange", onVisible); };
  }, [refresh]);

  const nodes = useMemo(() => {
    const statsByNode = new Map(snapshot.stats.map((row) => [row.node, row.data || {}]));
    const shares = new Map((snapshot.ring?.nodes || []).map((row) => [row.node, row.share]));
    return (snapshot.health?.nodes || []).map((item) => {
      const stat = statsByNode.get(item.node) || {};
      return {
        url: item.node,
        healthy: item.healthy,
        size: item.details?.size ?? stat.currentSize ?? 0,
        capacity: item.details?.capacity ?? stat.capacity ?? 0,
        hits: stat.hits || 0, misses: stat.misses || 0, evictions: stat.evictions || 0,
        expired: stat.expiredKeys || 0, uptimeSeconds: stat.uptimeSeconds ?? null,
        latencyMs: item.latencyMs, lastError: item.lastError, failures: item.consecutiveFailures || 0,
        share: shares.get(item.node) ?? null,
      };
    });
  }, [snapshot.health, snapshot.stats, snapshot.ring]);

  return { ...snapshot, nodes, history, refreshing, refresh, pollMs: POLL_MS, keyLimit: KEY_LIMIT };
}
