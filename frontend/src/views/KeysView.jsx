import { useCallback, useEffect, useMemo, useState } from "react";
import { api, enc } from "../api.js";
import Drawer from "../components/Drawer.jsx";
import NodeTag from "../components/NodeTag.jsx";
import { useNow } from "../hooks/useNow.js";
import { formatExpiry, int, nodeShort } from "../lib/format.js";

const PAGE = 100;

function Copies({ entry, inkOf }) {
  return (
    <span className="copies">
      {entry.owners.map((owner) => {
        const stored = entry.nodes.includes(owner);
        return (
          <span key={owner} className={`copy${stored ? "" : " missing"}`}>
            <NodeTag url={owner} ink={inkOf(owner)} down={!stored} />
            {!stored && <em>missing</em>}
          </span>
        );
      })}
      {entry.nodes.filter((node) => !entry.owners.includes(node)).map((node) => (
        <span key={node} className="copy extra"><NodeTag url={node} ink={inkOf(node)} /><em>extra</em></span>
      ))}
    </span>
  );
}

function KeyDrawer({ entry, inkOf, onClose, onLocate, onDeleted, notify }) {
  const now = useNow();
  const [state, setState] = useState({ loading: true });
  const [confirming, setConfirming] = useState(false);

  const load = useCallback(async () => {
    setState({ loading: true });
    try {
      const data = await api(`/cache/${enc(entry.key)}?peek=true`);
      setState({ value: data.value, expiresAt: data.expiresAt, servedBy: data.servedBy });
    } catch (error) {
      setState({ error: error.message });
    }
  }, [entry.key]);

  useEffect(() => { load(); }, [load]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(state.value, null, 2));
      notify("Value copied to the clipboard.");
    } catch { notify("Your browser blocked clipboard access.", "error"); }
  };

  const remove = async () => {
    if (!confirming) { setConfirming(true); return; }
    try {
      await api(`/cache/delete/${enc(entry.key)}`, { method: "DELETE" });
      notify(`Deleted ${entry.key}.`);
      onDeleted();
    } catch (error) { notify(error.message, "error"); setConfirming(false); }
  };

  const expiresAt = state.expiresAt === undefined ? entry.expiresAt : state.expiresAt;

  return (
    <Drawer title={entry.key} onClose={onClose}>
      <dl className="facts">
        <dt>Expires</dt>
        <dd>{formatExpiry(expiresAt, now)}</dd>
        <dt>Ring position</dt>
        <dd className="mono">{entry.position.toFixed(6)}</dd>
      </dl>

      <h3>Value</h3>
      {state.loading && <p className="muted">Reading the value…</p>}
      {state.error && <p className="inline-error" role="alert">{state.error}</p>}
      {state.value !== undefined && <pre className="json">{JSON.stringify(state.value, null, 2)}</pre>}
      <p className="muted small">Reading here doesn’t change recency or hit counts.</p>

      <h3>Copies</h3>
      <ul className="copy-list">
        {entry.owners.map((owner, index) => {
          const stored = entry.nodes.includes(owner);
          return (
            <li key={owner}>
              <NodeTag url={owner} ink={inkOf(owner)} down={!stored} />
              <span>{index === 0 ? "Primary" : "Replica"}</span>
              <span className={stored ? "ok-text" : "bad-text"}>{stored ? "Stored" : "Missing"}</span>
            </li>
          );
        })}
      </ul>
      {entry.underReplicated && <p className="muted small">A missing copy is restored the next time the key is read, or by Rebalance on the Cluster page.</p>}

      <div className="drawer-actions">
        <button className="btn" onClick={copy} disabled={state.value === undefined}>Copy value</button>
        <button className="btn" onClick={() => onLocate(entry.key)}>Show on ring</button>
        <button className="btn" onClick={load}>Reload</button>
        <button className={`btn btn-danger${confirming ? " armed" : ""}`} onClick={remove} onBlur={() => setConfirming(false)}>
          {confirming ? "Confirm delete" : "Delete key"}
        </button>
      </div>
    </Drawer>
  );
}

export default function KeysView({ cluster, inkOf, notify, onLocate }) {
  const { keys, nodes, keyLimit } = cluster;
  const now = useNow();
  const [filter, setFilter] = useState("");
  const [sort, setSort] = useState({ by: "key", dir: 1 });
  const [shown, setShown] = useState(PAGE);
  const [openKey, setOpenKey] = useState(null);
  const [pendingDelete, setPendingDelete] = useState(null);

  const rows = useMemo(() => {
    const term = filter.trim().toLowerCase();
    const list = term ? keys.keys.filter((entry) => entry.key.toLowerCase().includes(term)) : [...keys.keys];
    list.sort((a, b) => {
      if (sort.by === "expires") {
        const ax = a.expiresAt ?? Infinity;
        const bx = b.expiresAt ?? Infinity;
        return (ax - bx) * sort.dir;
      }
      return (a.key < b.key ? -1 : a.key > b.key ? 1 : 0) * sort.dir;
    });
    return list;
  }, [keys.keys, filter, sort]);

  const openEntry = openKey ? keys.keys.find((entry) => entry.key === openKey) : null;
  const toggleSort = (by) => setSort((old) => (old.by === by ? { by, dir: -old.dir } : { by, dir: 1 }));
  const ariaSort = (by) => (sort.by === by ? (sort.dir === 1 ? "ascending" : "descending") : "none");

  const removeRow = async (entry) => {
    if (pendingDelete !== entry.key) { setPendingDelete(entry.key); return; }
    setPendingDelete(null);
    try {
      await api(`/cache/delete/${enc(entry.key)}`, { method: "DELETE" });
      notify(`Deleted ${entry.key}.`);
      cluster.refresh();
    } catch (error) { notify(error.message, "error"); }
  };

  return (
    <>
      <section className="page-head">
        <h1>Keys</h1>
        <p className="lede">Every key in the cluster, where its copies are, and when it expires.</p>
      </section>

      <div className="toolbar">
        <div className="field grow">
          <label htmlFor="key-filter">Filter keys</label>
          <input id="key-filter" type="search" className="mono" value={filter} onChange={(event) => { setFilter(event.target.value); setShown(PAGE); }}
            placeholder="user:" spellCheck="false" autoComplete="off" />
        </div>
        <p className="toolbar-count" aria-live="polite">
          {int(rows.length)} of {int(keys.total)} {keys.total === 1 ? "key" : "keys"}
        </p>
      </div>

      <div className="table-wrap">
        <table className="ledger keys-table">
          <caption className="sr-only">Cached keys</caption>
          <thead>
            <tr>
              <th scope="col" aria-sort={ariaSort("key")}><button className="sort" onClick={() => toggleSort("key")}>Key{sort.by === "key" ? (sort.dir === 1 ? " ↑" : " ↓") : ""}</button></th>
              <th scope="col">Copies</th>
              <th scope="col" aria-sort={ariaSort("expires")}><button className="sort" onClick={() => toggleSort("expires")}>Expires{sort.by === "expires" ? (sort.dir === 1 ? " ↑" : " ↓") : ""}</button></th>
              <th scope="col"><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, shown).map((entry) => (
              <tr key={entry.key}>
                <th scope="row"><button className="key-link mono" onClick={() => setOpenKey(entry.key)}>{entry.key}</button></th>
                <td><Copies entry={entry} inkOf={inkOf} /></td>
                <td className={`expiry${entry.expiresAt != null && entry.expiresAt - now < 10_000 ? " soon" : ""}`}>{formatExpiry(entry.expiresAt, now)}</td>
                <td className="row-actions">
                  <button className="btn btn-quiet" onClick={() => onLocate(entry.key)}>On ring</button>
                  <button className={`btn btn-quiet danger${pendingDelete === entry.key ? " armed" : ""}`} onClick={() => removeRow(entry)} onBlur={() => setPendingDelete(null)}>
                    {pendingDelete === entry.key ? "Confirm delete" : "Delete"}
                  </button>
                </td>
              </tr>
            ))}
            {!rows.length && (
              <tr>
                <td colSpan="4" className="empty">
                  {filter ? `No keys contain “${filter}”.` : nodes.length ? "The cache is empty. Store a key or create sample keys from the Console." : "No data yet."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="table-foot">
        {rows.length > shown && <button className="btn" onClick={() => setShown((count) => count + PAGE)}>Show {Math.min(PAGE, rows.length - shown)} more</button>}
        {keys.total > keys.keys.length && <p className="muted small">The list holds the first {int(keyLimit)} keys of {int(keys.total)}. Look up any other key from the Console.</p>}
        {rows.some((entry) => entry.underReplicated) && <p className="muted small">Keys with a missing copy are restored when read, or all at once with Rebalance on the Cluster page. {nodes.length ? "" : ""}</p>}
      </div>

      {openEntry && (
        <KeyDrawer key={openEntry.key} entry={openEntry} inkOf={inkOf} notify={notify}
          onClose={() => setOpenKey(null)}
          onLocate={(key) => { setOpenKey(null); onLocate(key); }}
          onDeleted={() => { setOpenKey(null); cluster.refresh(); }} />
      )}
    </>
  );
}
