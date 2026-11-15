import { useRef, useState } from "react";
import { call, enc } from "../api.js";
import { curlFor, int, parseJson, ttlMs, valuePreview } from "../lib/format.js";

const NAMES = ["Ada Lovelace", "Alan Turing", "Grace Hopper", "Edsger Dijkstra", "Barbara Liskov", "Donald Knuth", "Margaret Hamilton", "Leslie Lamport"];
const PLANS = ["free", "pro", "team"];

async function pool(count, limit, task) {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, count) }, async () => {
    while (next < count) await task(next++);
  }));
}

export default function ConsoleView({ cluster, notify, onLocate }) {
  const [writeKey, setWriteKey] = useState("user:123");
  const [writeValue, setWriteValue] = useState('{\n  "name": "Ada Lovelace",\n  "plan": "pro"\n}');
  const [ttlAmount, setTtlAmount] = useState("");
  const [ttlUnit, setTtlUnit] = useState("minutes");
  const [writeError, setWriteError] = useState("");
  const [readKey, setReadKey] = useState("user:123");
  const [log, setLog] = useState([]);
  const [open, setOpen] = useState(null);
  const [seedCount, setSeedCount] = useState("100");
  const [seedTtl, setSeedTtl] = useState("");
  const [readCount, setReadCount] = useState("200");
  const [missShare, setMissShare] = useState("20");
  const [progress, setProgress] = useState(null);
  const [confirmFlush, setConfirmFlush] = useState(false);
  const counter = useRef(0);

  const run = async (path, options) => {
    const result = await call(path, options);
    const entry = { id: ++counter.current, at: Date.now(), ...result };
    setLog((old) => [entry, ...old].slice(0, 25));
    setOpen(entry.id);
    cluster.refresh();
    return result;
  };

  const store = async (event) => {
    event.preventDefault();
    setWriteError("");
    if (!writeKey.trim()) { setWriteError("Enter a key."); return; }
    const parsed = parseJson(writeValue);
    if (!parsed.ok) { setWriteError(`The value isn’t valid JSON: ${parsed.message}`); return; }
    const ttl = ttlMs(ttlAmount, ttlUnit);
    if (Number.isNaN(ttl)) { setWriteError("Expiry must be a number greater than zero, or blank for no expiry."); return; }
    const body = { key: writeKey.trim(), value: parsed.value };
    if (ttl !== undefined) body.ttl = ttl;
    await run("/cache", { method: "POST", body });
    setReadKey(body.key);
  };

  const read = (kind) => {
    const key = readKey.trim();
    if (!key) { notify("Enter a key to look up.", "error"); return; }
    if (kind === "get") return run(`/cache/${enc(key)}`);
    if (kind === "peek") return run(`/cache/${enc(key)}?peek=true`);
    if (kind === "has") return run(`/cache/has/${enc(key)}`);
    if (kind === "delete") return run(`/cache/delete/${enc(key)}`, { method: "DELETE" });
    return undefined;
  };

  const seed = async () => {
    const count = Math.max(1, Math.min(2000, Number(seedCount) || 0));
    const ttl = seedTtl ? Number(seedTtl) : undefined;
    let failed = 0;
    setProgress({ label: "Creating keys", done: 0, total: count });
    let done = 0;
    await pool(count, 12, async (index) => {
      const key = `demo:${String(index + 1).padStart(4, "0")}`;
      const value = { id: index + 1, name: NAMES[index % NAMES.length], plan: PLANS[index % PLANS.length], score: Math.round(Math.random() * 1000) };
      const result = await call("/cache", { method: "POST", body: { key, value, ...(ttl ? { ttl } : {}) } });
      if (!result.ok) failed++;
      setProgress({ label: "Creating keys", done: ++done, total: count });
    });
    setProgress(null);
    notify(failed ? `Created ${count - failed} keys; ${failed} failed.` : `Created ${count} keys named demo:0001 and up.`, failed ? "error" : "ok");
    cluster.refresh();
  };

  const sendReads = async () => {
    const count = Math.max(1, Math.min(5000, Number(readCount) || 0));
    const misses = Math.min(100, Math.max(0, Number(missShare) || 0)) / 100;
    const pool_ = cluster.keys.keys.map((entry) => entry.key);
    if (!pool_.length && misses < 1) { notify("The cache is empty. Create sample keys first.", "error"); return; }
    let hits = 0;
    let missed = 0;
    let errors = 0;
    let done = 0;
    setProgress({ label: "Sending reads", done: 0, total: count });
    await pool(count, 10, async () => {
      const wantMiss = !pool_.length || Math.random() < misses;
      const key = wantMiss ? `missing:${Math.random().toString(36).slice(2, 10)}` : pool_[Math.floor(Math.random() * pool_.length)];
      const result = await call(`/cache/${enc(key)}`);
      if (result.status === 200) hits++;
      else if (result.status === 404) missed++;
      else errors++;
      setProgress({ label: "Sending reads", done: ++done, total: count });
    });
    setProgress(null);
    notify(`Sent ${count} reads: ${hits} hits, ${missed} misses${errors ? `, ${errors} errors` : ""}.`, errors ? "error" : "ok");
    cluster.refresh();
  };

  const flush = async () => {
    if (!confirmFlush) { setConfirmFlush(true); return; }
    setConfirmFlush(false);
    const result = await call("/cache", { method: "DELETE" });
    if (result.ok) notify(`Flushed ${int(result.data.removed)} entries from every node.`);
    else notify(result.data?.message || "Flush failed.", "error");
    cluster.refresh();
  };

  return (
    <>
      <section className="page-head">
        <h1>Console</h1>
        <p className="lede">Send requests to the router and see exactly what it answers. Each request is also shown as a curl command.</p>
      </section>

      <div className="console-grid">
        <div className="console-forms">
          <form className="panel" onSubmit={store}>
            <h2>Store a key</h2>
            <div className="field">
              <label htmlFor="w-key">Key</label>
              <input id="w-key" className="mono" value={writeKey} onChange={(event) => setWriteKey(event.target.value)} spellCheck="false" autoComplete="off" />
            </div>
            <div className="field">
              <label htmlFor="w-value">Value, as JSON</label>
              <textarea id="w-value" className="mono" rows="4" value={writeValue} onChange={(event) => setWriteValue(event.target.value)} spellCheck="false" />
            </div>
            <div className="field-row">
              <div className="field">
                <label htmlFor="w-ttl">Expires after</label>
                <input id="w-ttl" inputMode="decimal" value={ttlAmount} onChange={(event) => setTtlAmount(event.target.value)} placeholder="Never" />
              </div>
              <div className="field">
                <label htmlFor="w-unit">Unit</label>
                <select id="w-unit" value={ttlUnit} onChange={(event) => setTtlUnit(event.target.value)}>
                  <option value="seconds">seconds</option>
                  <option value="minutes">minutes</option>
                  <option value="hours">hours</option>
                </select>
              </div>
            </div>
            {writeError && <p className="inline-error" role="alert">{writeError}</p>}
            <button className="btn btn-primary" type="submit">Store key</button>
          </form>

          <div className="panel">
            <h2>Look up a key</h2>
            <div className="field">
              <label htmlFor="r-key">Key</label>
              <input id="r-key" className="mono" value={readKey} onChange={(event) => setReadKey(event.target.value)} spellCheck="false" autoComplete="off" />
            </div>
            <div className="button-row">
              <button className="btn btn-primary" onClick={() => read("get")}>Get</button>
              <button className="btn" onClick={() => read("peek")} title="Read without changing recency or hit counts">Peek</button>
              <button className="btn" onClick={() => read("has")}>Exists</button>
              <button className="btn" onClick={() => readKey.trim() && onLocate(readKey.trim())}>Show on ring</button>
              <button className="btn btn-danger" onClick={() => read("delete")}>Delete</button>
            </div>
            <p className="muted small">Get counts as a read and refreshes the key’s recency. Peek does neither.</p>
          </div>

          <div className="panel">
            <h2>Generate traffic</h2>
            <div className="field-row">
              <div className="field">
                <label htmlFor="s-count">Sample keys to create</label>
                <input id="s-count" inputMode="numeric" value={seedCount} onChange={(event) => setSeedCount(event.target.value)} />
              </div>
              <div className="field">
                <label htmlFor="s-ttl">They expire</label>
                <select id="s-ttl" value={seedTtl} onChange={(event) => setSeedTtl(event.target.value)}>
                  <option value="">Never</option>
                  <option value="30000">After 30 seconds</option>
                  <option value="120000">After 2 minutes</option>
                </select>
              </div>
            </div>
            <button className="btn" onClick={seed} disabled={!!progress}>Create sample keys</button>

            <div className="field-row spaced">
              <div className="field">
                <label htmlFor="g-count">Reads to send</label>
                <input id="g-count" inputMode="numeric" value={readCount} onChange={(event) => setReadCount(event.target.value)} />
              </div>
              <div className="field">
                <label htmlFor="g-miss">Percent that ask for missing keys</label>
                <input id="g-miss" inputMode="numeric" value={missShare} onChange={(event) => setMissShare(event.target.value)} />
              </div>
            </div>
            <button className="btn" onClick={sendReads} disabled={!!progress}>Send reads</button>

            {progress && (
              <div className="progress" role="status">
                <span className="bar" aria-hidden="true"><span style={{ width: `${(100 * progress.done) / progress.total}%` }} /></span>
                {progress.label}: {int(progress.done)} of {int(progress.total)}
              </div>
            )}

            <hr />
            <button className={`btn btn-danger${confirmFlush ? " armed" : ""}`} onClick={flush} onBlur={() => setConfirmFlush(false)}>
              {confirmFlush ? `Confirm: delete all ${int(cluster.keys.total)} keys` : "Flush the whole cluster"}
            </button>
          </div>
        </div>

        <div className="panel transcript">
          <h2>Requests</h2>
          {log.length === 0 ? (
            <p className="empty-block">Nothing sent yet. Store a key on the left and the request and the router’s answer appear here.</p>
          ) : (
            <ol className="log">
              {log.map((entry) => {
                const expanded = open === entry.id;
                const tone = entry.status === 0 || entry.status >= 500 ? "error" : entry.status >= 400 ? "warn" : "ok";
                return (
                  <li key={entry.id} className={expanded ? "open" : undefined}>
                    <button className="log-line" onClick={() => setOpen(expanded ? null : entry.id)} aria-expanded={expanded}>
                      <span className={`status ${tone}`}>{entry.status || "ERR"}</span>
                      <span className="log-method">{entry.method}</span>
                      <span className="log-path mono">{decodeURIComponent(entry.path)}</span>
                      <span className="log-ms">{entry.ms < 10 ? entry.ms.toFixed(1) : Math.round(entry.ms)} ms</span>
                    </button>
                    {expanded && (
                      <div className="log-detail">
                        <pre className="curl">{curlFor(entry)}</pre>
                        <pre className="json">{JSON.stringify(entry.data, null, 2)}</pre>
                        {entry.data?.value !== undefined && <p className="muted small">Value: {valuePreview(entry.data.value, 120)}</p>}
                      </div>
                    )}
                  </li>
                );
              })}
            </ol>
          )}
        </div>
      </div>
    </>
  );
}
