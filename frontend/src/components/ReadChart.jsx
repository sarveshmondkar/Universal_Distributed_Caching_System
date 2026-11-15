import { int } from "../lib/format.js";

const W = 640;
const H = 190;
const PAD = { left: 34, right: 6, top: 8, bottom: 24 };
const SLOTS = 30;

function niceMax(value) {
  if (value <= 4) return 4;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  for (const step of [1, 2, 4, 5, 10]) if (step * magnitude >= value) return step * magnitude;
  return value;
}

/** Stacked bars of hits (solid) and misses (outlined) for each polling interval. */
export default function ReadChart({ history, pollMs }) {
  const bars = history.slice(-SLOTS);
  const max = niceMax(Math.max(0, ...bars.map((bar) => bar.hits + bar.misses)));
  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;
  const slot = innerW / SLOTS;
  const barW = slot * 0.68;
  const y = (value) => PAD.top + innerH - (value / max) * innerH;
  const totalReads = bars.reduce((sum, bar) => sum + bar.hits + bar.misses, 0);
  const seconds = Math.round((SLOTS * pollMs) / 1000);
  const label = totalReads
    ? `Reads in each ${pollMs / 1000} second interval: ${int(bars.reduce((s, b) => s + b.hits, 0))} hits and ${int(bars.reduce((s, b) => s + b.misses, 0))} misses over the last ${bars.length} intervals.`
    : "No reads recorded yet.";

  return (
    <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label}>
      <title>{label}</title>
      {[0, 0.5, 1].map((fraction) => (
        <g key={fraction}>
          <line x1={PAD.left} x2={W - PAD.right} y1={y(max * fraction)} y2={y(max * fraction)} className="chart-grid" />
          <text x={PAD.left - 8} y={y(max * fraction) + 4} textAnchor="end" className="chart-axis">{int(Math.round(max * fraction))}</text>
        </g>
      ))}
      {bars.map((bar, index) => {
        const x = PAD.left + (SLOTS - bars.length + index) * slot + (slot - barW) / 2;
        return (
          <g key={bar.at}>
            {bar.hits > 0 && <rect x={x} y={y(bar.hits)} width={barW} height={y(0) - y(bar.hits)} className="bar-hit" />}
            {bar.misses > 0 && <rect x={x} y={y(bar.hits + bar.misses)} width={barW} height={y(bar.hits) - y(bar.hits + bar.misses)} className="bar-miss" />}
          </g>
        );
      })}
      <text x={PAD.left} y={H - 5} className="chart-axis">{seconds >= 60 ? `${Math.round(seconds / 60)} min ago` : `${seconds}s ago`}</text>
      <text x={W - PAD.right} y={H - 5} textAnchor="end" className="chart-axis">now</text>
      {!totalReads && <text x={PAD.left + innerW / 2} y={PAD.top + innerH / 2 - 10} textAnchor="middle" className="chart-empty">No reads since you opened this page. Send some from the Console.</text>}
    </svg>
  );
}
