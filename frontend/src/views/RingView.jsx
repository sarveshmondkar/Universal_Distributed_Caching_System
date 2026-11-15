import { useEffect, useMemo, useState } from "react";
import { call, enc } from "../api.js";
import Ring from "../components/Ring.jsx";
import ReadChart from "../components/ReadChart.jsx";
import NodeTag from "../components/NodeTag.jsx";
import { clock, int, nodeShort, percent } from "../lib/format.js";

function headline({ loaded, reachable, health, metrics, keys, ring }) {
  if (!loaded) return { title: "Connecting to the router…", lede: "" };
  if (!reachable) return { title: "The router isn’t answering.", lede: "Start it on port 3000, or check that the dashboard proxy points at it." };
  const total = health?.totalNodes ?? 0;
  const up = health?.healthyNodes ?? 0;
  const rf = health?.replicationFactor ?? ring?.replicationFactor ?? 1;
  const reads = metrics?.reads?.count ?? 0;
  const copies = `Each is stored on ${rf} ${rf === 1 ? "node" : "nodes"}, chosen by hashing the key onto the ring below.`;
  if (up === 0) return { title: "No cache nodes are reachable.", lede: "Check that the cache nodes are running and that the router can resolve their addresses." };
  if (up < total) {
    return {
      title: `${up} of ${total} nodes up.`,
      lede: rf > 1
        ? "Reads fall back to replicas, and writes go to the next healthy node on the ring."
        : "Keys owned by the missing nodes can’t be read until those nodes return.",
    };
  }
  return {
    title: reads ? `${total} ${total === 1 ? "node" : "nodes"} up, ${percent(metrics.reads.hitRate, 0)} of reads served from cache.` : `${total} ${total === 1 ? "node" : "nodes"} up. No reads yet.`,
    lede: `${int(keys.total)} ${keys.total === 1 ? "key" : "keys"}. ${copies}`,
  };
}

const OUTCOME = { hit: "hit", miss: "miss", ok: "ok", error: "error" };

export default function RingView({ cluster, inkOf, focusKey, setFocusKey }) {
  const { loaded, reachable, health, metrics, keys, ring, nodes, history, pollMs } = cluster;
  const [located, setLocated] = useState(null);
  const [locateError, setLocateError] = useState("");
  const [highlight, setHighlight] = useState(null);
  const ringVersion = ring?.ringVersion;

  useEffect(() => {
    const key = focusKey.trim();
    if (!key) { setLocated(null); setLocateError(""); return undefined; }
    let cancelled = false;
    const timer = setTimeout(async () => {
      const result = await call(`/cache/locate/${enc(key)}`);
      if (cancelled) return;
      if (result.ok) { setLocated(result.data); setLocateError(""); }
      else { setLocated(null); setLocateError(result.data?.message || "Could not locate that key."); }
    }, 220);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [focusKey, ringVersion]);

  const holders = useMemo(() => {
    if (!located || keys.total > keys.keys.length) return undefined;
    return keys.keys.find((entry) => entry.key === located.key)?.nodes ?? [];
  }, [located, keys]);

  const { title, lede } = headline({ loaded, reachable, health, metrics, keys, ring });
  const rf = health?.replicationFactor ?? 1;
  const reads = metrics?.reads;
  const totals = nodes.reduce((sum, node) => ({ size: sum.size + node.size, capacity: sum.capacity + node.capacity, evictions: sum.evictions + node.evictions }), { size: 0, capacity: 0, evictions: 0 });

  return (
    <>
      <section className="headline">
        <h1>{title}</h1>
        {lede && <p className="lede">{lede}</p>}
      </section>

      <section className="plate" aria-label="Hash ring">
        <div className="plate-ring">
          <Ring ring={ring} inkOf={inkOf} keys={keys.keys} located={located} highlight={highlight} total={keys.total} nodeCount={nodes.length} />
        </div>

        <div className="plate-side on-plate">
          <h2>Where does a key live?</h2>
          <p className="plate-note">
            A key’s hash picks a point on the ring. The first node clockwise from that point owns the key, and the next distinct nodes hold its replicas.
          </p>

          <div className="field">
            <label htmlFor="locate-key">Key</label>
            <input id="locate-key" className="mono" value={focusKey} onChange={(event) => setFocusKey(event.target.value)}
              placeholder="user:4821" spellCheck="false" autoComplete="off" />
          </div>

          {locateError && <p className="plate-error" role="alert">{locateError}</p>}

          {located ? (
            <div className="locate-result">
              <ol className="walk-list">
                {located.walk.map((step, index) => (
                  <li key={step.node} className={step.role === "standby" ? "standby" : undefined}>
                    <span className="walk-index" style={step.role === "standby" ? undefined : { background: inkOf(step.node).color }} aria-hidden="true">
                      {step.role === "standby" ? "" : index + 1}
                    </span>
                    <span className="walk-node">{nodeShort(step.node)}</span>
                    <span className="walk-role">{step.role === "primary" ? "Primary" : step.role === "replica" ? "Replica" : "Next in line"}{step.healthy ? "" : ", down"}</span>
                    <span className="walk-pos">{step.position.toFixed(4)}</span>
                  </li>
                ))}
              </ol>
              <dl className="plate-facts">
                <dt>SHA-256</dt>
                <dd className="mono" title={located.hash}>{located.hash.slice(0, 10)}…{located.hash.slice(-6)}</dd>
                <dt>Ring position</dt>
                <dd className="mono">{located.position.toFixed(6)}</dd>
                {holders !== undefined && (
                  <>
                    <dt>In the cache</dt>
                    <dd>{holders.length ? `Yes, on ${holders.map(nodeShort).join(" and ")}` : "No. Store it from the Console."}</dd>
                  </>
                )}
              </dl>
            </div>
          ) : (
            <div className="plate-legend">
              <h3>Nodes on the ring</h3>
              <ul>
                {nodes.map((node) => (
                  <li key={node.url} onMouseEnter={() => setHighlight(node.url)} onMouseLeave={() => setHighlight(null)}>
                    <i style={{ background: inkOf(node.url).color }} aria-hidden="true" />
                    <span className="legend-name">{nodeShort(node.url)}</span>
                    <span className="legend-share">{node.share === null ? "" : `${percent(node.share, 1)} of the ring`}</span>
                    <span className="legend-keys">{int(node.size)} keys</span>
                  </li>
                ))}
              </ul>
              <p className="plate-note">Each coloured stretch of the outer band is owned by one node. Dots are cached keys, placed by their hash.</p>
            </div>
          )}
        </div>
      </section>

      <section className="block">
        <div className="block-head">
          <h2>Nodes</h2>
          <p>Each node holds its own keys in memory and evicts the least recently used when full.</p>
        </div>
        <div className="table-wrap">
          <table className="ledger">
            <caption className="sr-only">Cache nodes and their statistics</caption>
            <thead>
              <tr>
                <th scope="col">Node</th>
                <th scope="col">State</th>
                <th scope="col">Memory used</th>
                <th scope="col" className="num">Reads</th>
                <th scope="col" className="num">Hit rate</th>
                <th scope="col" className="num">Evictions</th>
                <th scope="col" className="num">Ring share</th>
                <th scope="col" className="num">Latency</th>
              </tr>
            </thead>
            <tbody>
              {nodes.map((node) => {
                const used = node.capacity ? Math.min(100, (100 * node.size) / node.capacity) : 0;
                const nodeReads = node.hits + node.misses;
                return (
                  <tr key={node.url} onMouseEnter={() => setHighlight(node.url)} onMouseLeave={() => setHighlight(null)}>
                    <th scope="row"><NodeTag url={node.url} ink={inkOf(node.url)} down={!node.healthy} /></th>
                    <td><span className={`state ${node.healthy ? "up" : "down"}`}><i aria-hidden="true" />{node.healthy ? "Up" : "Down"}</span></td>
                    <td>
                      <span className="load">
                        <span className="bar" aria-hidden="true"><span className={used > 85 ? "hot" : undefined} style={{ width: `${used}%` }} /></span>
                        <span className="load-text">{int(node.size)} of {int(node.capacity)}</span>
                      </span>
                    </td>
                    <td className="num">{int(nodeReads)}</td>
                    <td className="num">{nodeReads ? percent(node.hits / nodeReads) : "n/a"}</td>
                    <td className="num">{int(node.evictions)}</td>
                    <td className="num">{node.share === null ? "n/a" : percent(node.share)}</td>
                    <td className="num">{node.healthy && node.latencyMs != null ? `${node.latencyMs} ms` : "n/a"}</td>
                  </tr>
                );
              })}
              {!nodes.length && <tr><td colSpan="8" className="empty">{loaded ? "No node information yet." : "Loading nodes…"}</td></tr>}
            </tbody>
            {nodes.length > 0 && (
              <tfoot>
                <tr>
                  <th scope="row">Whole cluster</th>
                  <td />
                  <td><span className="load-text">{int(totals.size)} of {int(totals.capacity)}</span></td>
                  <td className="num">{int(reads?.count)}</td>
                  <td className="num">{percent(reads?.hitRate)}</td>
                  <td className="num">{int(totals.evictions)}</td>
                  <td className="num">{rf}× replicated</td>
                  <td className="num">{metrics ? `${metrics.ops?.get?.p95 ?? 0} ms p95` : "n/a"}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
        <p className="foot-note">Cluster reads and hit rate are measured at the router, so one missed read counts once even if it asked several replicas. Per-node figures count what each node saw.</p>
      </section>

      <section className="activity">
        <div className="block">
          <div className="block-head">
            <h2>Reads over time</h2>
            <p>Hits and misses in each {pollMs / 1000} second interval.</p>
          </div>
          <ReadChart history={history} pollMs={pollMs} />
          <p className="legend-inline">
            <span><i className="swatch hit" aria-hidden="true" />Hit</span>
            <span><i className="swatch miss" aria-hidden="true" />Miss</span>
            <span className="rps">{metrics ? `${metrics.requestsPerSecond} requests per second` : ""}</span>
          </p>
        </div>

        <div className="block">
          <div className="block-head">
            <h2>Latest requests</h2>
            <p>What the router just handled.</p>
          </div>
          {metrics?.recent?.length ? (
            <ol className="feed">
              {metrics.recent.slice(0, 9).map((event, index) => (
                <li key={`${event.at}-${index}`}>
                  <time>{clock(event.at)}</time>
                  <span className="feed-op">{event.op}</span>
                  <span className="feed-key mono" title={event.key ?? ""}>{event.key ?? event.detail ?? ""}</span>
                  <span className={`feed-outcome ${event.outcome}`}>{OUTCOME[event.outcome] ?? event.outcome}</span>
                  <span className="feed-ms">{event.ms} ms</span>
                </li>
              ))}
            </ol>
          ) : (
            <p className="empty-block">Nothing yet. Requests from the Console, your own scripts or curl show up here.</p>
          )}
        </div>
      </section>
    </>
  );
}
