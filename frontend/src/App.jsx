import { useCallback, useEffect, useState } from "react";
import { useCluster } from "./hooks/useCluster.js";
import { useInks } from "./lib/inks.js";
import { clock } from "./lib/format.js";
import Notice from "./components/Notice.jsx";
import RingView from "./views/RingView.jsx";
import KeysView from "./views/KeysView.jsx";
import ConsoleView from "./views/ConsoleView.jsx";
import ClusterView from "./views/ClusterView.jsx";

const VIEWS = [
  { id: "ring", label: "Ring" },
  { id: "keys", label: "Keys" },
  { id: "console", label: "Console" },
  { id: "cluster", label: "Cluster" },
];

const readHash = () => {
  const id = window.location.hash.replace(/^#\/?/, "");
  return VIEWS.some((view) => view.id === id) ? id : "ring";
};

export default function App() {
  const [view, setView] = useState(readHash);
  const [focusKey, setFocusKey] = useState("");
  const [notice, setNotice] = useState(null);
  const cluster = useCluster();
  const inkOf = useInks(cluster.nodes.map((node) => node.url));

  useEffect(() => {
    const onHash = () => setView(readHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  useEffect(() => {
    const label = VIEWS.find((item) => item.id === view)?.label ?? "Ring";
    document.title = `${label} · Universal Cache`;
    window.scrollTo({ top: 0 });
  }, [view]);

  const go = useCallback((id) => { window.location.hash = `/${id}`; }, []);
  const notify = useCallback((message, tone = "ok") => setNotice({ message, tone, id: Date.now() }), []);
  const dismiss = useCallback(() => setNotice(null), []);
  const locate = useCallback((key) => { setFocusKey(key); go("ring"); }, [go]);

  const total = cluster.health?.totalNodes ?? 0;
  const up = cluster.health?.healthyNodes ?? 0;
  const state = !cluster.loaded ? "wait" : !cluster.reachable || up === 0 ? "down" : up < total ? "partial" : "up";
  const statusText = { wait: "Connecting", down: cluster.reachable ? "No nodes up" : "Router offline", partial: `${up} of ${total} nodes up`, up: `${up} of ${total} nodes up` }[state];

  return (
    <>
      <a className="skip" href="#main">Skip to content</a>
      <header className="topbar">
        <a className="brand" href="#/ring" aria-label="Universal Cache, ring view">
          <svg viewBox="0 0 32 32" width="26" height="26" aria-hidden="true">
            <circle cx="16" cy="16" r="11" fill="none" stroke="currentColor" strokeWidth="5" />
            <circle cx="16" cy="5" r="4.2" fill="#FFD83D" stroke="currentColor" strokeWidth="1.6" />
          </svg>
          Universal Cache
        </a>
        <nav aria-label="Sections">
          {VIEWS.map((item) => (
            <a key={item.id} href={`#/${item.id}`} className={view === item.id ? "active" : undefined} aria-current={view === item.id ? "page" : undefined}>{item.label}</a>
          ))}
        </nav>
        <div className="topbar-status">
          <span className={`status-pill ${state}`}><i aria-hidden="true" />{statusText}</span>
          <button className="btn btn-quiet" onClick={cluster.refresh} disabled={cluster.refreshing}>
            {cluster.refreshing ? "Refreshing…" : cluster.updatedAt ? `Refresh, updated ${clock(cluster.updatedAt)}` : "Refresh"}
          </button>
        </div>
      </header>

      <main id="main">
        {!cluster.reachable && cluster.loaded && view !== "ring" && (
          <p className="banner" role="alert">The router isn’t answering, so what you see below may be out of date.</p>
        )}
        {view === "ring" && <RingView cluster={cluster} inkOf={inkOf} focusKey={focusKey} setFocusKey={setFocusKey} />}
        {view === "keys" && <KeysView cluster={cluster} inkOf={inkOf} notify={notify} onLocate={locate} />}
        {view === "console" && <ConsoleView cluster={cluster} notify={notify} onLocate={locate} />}
        {view === "cluster" && <ClusterView cluster={cluster} inkOf={inkOf} notify={notify} />}
      </main>

      <footer className="page-foot">
        Consistent hashing, replication, TTL expiry and LRU eviction, across Node.js cache nodes.
      </footer>
      <Notice notice={notice} onDismiss={dismiss} />
    </>
  );
}
