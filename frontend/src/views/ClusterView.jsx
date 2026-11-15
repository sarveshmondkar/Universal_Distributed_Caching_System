import { useCallback, useEffect, useState } from "react";
import { call, enc } from "../api.js";
import NodeTag from "../components/NodeTag.jsx";
import { duration, int, nodeHost, percent } from "../lib/format.js";

const LANE = 16;

export default function ClusterView({ cluster, inkOf, notify }) {
  const { nodes, health, ring, metrics, loaded } = cluster;
  const [lanes, setLanes] = useState({});
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState("");
  const [confirmRemove, setConfirmRemove] = useState(null);

  const loadLanes = useCallback(async () => {
    const result = await call(`/cache/debug?limit=${LANE}`);
    if (!result.ok) return;
    setLanes(Object.fromEntries((result.data.nodes || []).map((row) => [row.node, row.data])));
  }, []);

  useEffect(() => {
    loadLanes();
    const timer = setInterval(() => { if (!document.hidden) loadLanes(); }, cluster.pollMs);
    return () => clearInterval(timer);
  }, [loadLanes, cluster.pollMs]);

  const summary = (rebalance) => {
    const parts = [`Scanned ${int(rebalance.scanned)} keys`, `copied ${int(rebalance.copied)}`, `removed ${int(rebalance.removed)} surplus`];
    if (rebalance.failed) parts.push(`${int(rebalance.failed)} failed`);
    if (rebalance.unreachable?.length) parts.push(`${rebalance.unreachable.length} node unreachable`);
    return `${parts.join(", ")}.`;
  };

  const act = async (label, path, options, done) => {
    setBusy(label);
    const result = await call(path, options);
    setBusy("");
    if (result.ok) notify(done(result.data), result.data.rebalance?.failed ? "error" : "ok");
    else notify(result.data?.message || "That didn’t work.", "error");
    await Promise.all([cluster.refresh(), loadLanes()]);
    return result.ok;
  };

  const add = async (event) => {
    event.preventDefault();
    if (!url.trim()) { notify("Enter the node’s address, for example http://cache4:4001.", "error"); return; }
    const ok = await act("add", "/cluster/nodes", { method: "POST", body: { url: url.trim() } }, (data) => `${data.rebalance.failed ? "Node added, but some keys could not be moved." : "Node added."} ${summary(data.rebalance)}`);
    if (ok) setUrl("");
  };

  const remove = async (node) => {
    if (confirmRemove !== node) { setConfirmRemove(node); return; }
    setConfirmRemove(null);
    await act("remove", `/cluster/nodes?url=${enc(node)}`, { method: "DELETE" }, (data) => `${data.rebalance.failed ? "Node removed, but some keys could not be moved." : "Node removed."} ${summary(data.rebalance)}`);
  };

  const ops = Object.entries(metrics?.ops || {});
  const counters = metrics?.counters || {};
  const rf = health?.replicationFactor ?? 1;

  return (
    <>
      <section className="page-head">
        <h1>Cluster</h1>
        <p className="lede">Membership, what each node would evict next, and how the router is performing.</p>
      </section>

      <section className="block">
        <div className="block-head">
          <h2>Nodes and eviction order</h2>
          <p>Each strip lists the {LANE} least recently used keys on that node, left to right. The leftmost key goes first when the node is full.</p>
        </div>
        <div className="node-blocks">
          {nodes.map((node) => {
            const lane = lanes[node.url];
            const used = node.capacity ? Math.min(100, (100 * node.size) / node.capacity) : 0;
            return (
              <article key={node.url} className="node-block">
                <header>
                  <div className="node-title">
                    <NodeTag url={node.url} ink={inkOf(node.url)} down={!node.healthy} />
                    <span className="mono host">{nodeHost(node.url)}</span>
                    <span className={`state ${node.healthy ? "up" : "down"}`}><i aria-hidden="true" />{node.healthy ? "Up" : "Down"}</span>
                  </div>
                  <button className={`btn btn-quiet danger${confirmRemove === node.url ? " armed" : ""}`} disabled={nodes.length < 2 || !!busy}
                    onClick={() => remove(node.url)} onBlur={() => setConfirmRemove(null)}
                    title={nodes.length < 2 ? "A cluster needs at least one node" : "Move this node’s keys to the others, then remove it"}>
                    {confirmRemove === node.url ? "Confirm: move keys and remove" : "Remove node"}
                  </button>
                </header>
                <p className="node-meta">
                  {int(node.size)} of {int(node.capacity)} keys used
                  {node.uptimeSeconds != null && node.healthy ? `, up for ${duration(node.uptimeSeconds)}` : ""}
                  {!node.healthy && node.lastError ? `. Last error: ${node.lastError}` : ""}
                </p>
                <span className="bar wide" aria-hidden="true"><span className={used > 85 ? "hot" : undefined} style={{ width: `${used}%` }} /></span>
                {node.healthy && lane ? (
                  lane.order.length ? (
                    <ol className="lane" aria-label={`Least recently used keys on ${nodeHost(node.url)}`}>
                      {lane.order.map((item, index) => (
                        <li key={item.key} className={index === 0 ? "next" : undefined} title={item.key}>
                          <span className="mono">{item.key}</span>
                          {index === 0 && <em>evicted first</em>}
                        </li>
                      ))}
                      {lane.truncated && <li className="more" aria-hidden="true">…</li>}
                    </ol>
                  ) : <p className="muted small">This node holds no keys.</p>
                ) : null}
              </article>
            );
          })}
          {!nodes.length && <p className="empty-block">{loaded ? "No nodes to show." : "Loading…"}</p>}
        </div>
      </section>

      <section className="split">
        <div className="panel">
          <h2>Membership</h2>
          <dl className="facts">
            <dt>Copies of each key</dt>
            <dd>{rf}</dd>
            <dt>Ring points per node</dt>
            <dd>{ring?.virtualNodes ?? "n/a"}</dd>
            <dt>Health checks</dt>
            <dd>Every few seconds, and on every failed request</dd>
          </dl>
          <form onSubmit={add}>
            <div className="field">
              <label htmlFor="node-url">Add a running node</label>
              <input id="node-url" className="mono" value={url} onChange={(event) => setUrl(event.target.value)} placeholder="http://cache4:4001" spellCheck="false" autoComplete="off" />
            </div>
            <div className="button-row">
              <button className="btn btn-primary" type="submit" disabled={!!busy}>{busy === "add" ? "Adding and moving keys…" : "Add node"}</button>
              <button type="button" className="btn" disabled={!!busy}
                onClick={() => act("rebalance", "/cluster/rebalance", { method: "POST" }, (data) => summary(data.rebalance))}>
                {busy === "rebalance" ? "Rebalancing…" : "Rebalance now"}
              </button>
            </div>
          </form>
          <p className="muted small">Adding a node moves only the keys it now owns. Removing one copies its keys to their new owners first. Membership resets to the router’s CACHE_NODES setting when it restarts.</p>
        </div>

        <div className="panel">
          <h2>Router</h2>
          {metrics ? (
            <>
              <div className="table-wrap">
                <table className="ledger compact">
                  <caption className="sr-only">Requests handled by the router</caption>
                  <thead>
                    <tr><th scope="col">Request</th><th scope="col" className="num">Count</th><th scope="col" className="num">Median</th><th scope="col" className="num">95th</th><th scope="col" className="num">99th</th><th scope="col" className="num">Errors</th></tr>
                  </thead>
                  <tbody>
                    {ops.map(([name, op]) => (
                      <tr key={name}>
                        <th scope="row">{name}</th>
                        <td className="num">{int(op.count)}</td>
                        <td className="num">{op.p50} ms</td>
                        <td className="num">{op.p95} ms</td>
                        <td className="num">{op.p99} ms</td>
                        <td className="num">{int(op.errors)}</td>
                      </tr>
                    ))}
                    {!ops.length && <tr><td colSpan="6" className="empty">No requests yet.</td></tr>}
                  </tbody>
                </table>
              </div>
              <dl className="facts">
                <dt>Read hit rate</dt>
                <dd>{percent(metrics.reads.hitRate)}</dd>
                <dt>Copies restored by reads</dt>
                <dd>{int(counters.readRepairs)}</dd>
                <dt>Keys moved by rebalancing</dt>
                <dd>{int(counters.rebalanceCopies)}</dd>
                <dt>Router uptime</dt>
                <dd>{duration(metrics.uptimeSeconds)}</dd>
              </dl>
            </>
          ) : <p className="empty-block">Waiting for the router.</p>}
        </div>
      </section>
    </>
  );
}
