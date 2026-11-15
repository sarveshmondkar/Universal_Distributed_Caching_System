import { useMemo } from "react";
import { int } from "../lib/format.js";

const C = 350;
const BAND_MID = 287;
const BAND = 26;
const TAU = Math.PI * 2;

const angle = (position) => position * TAU - Math.PI / 2;
const point = (position, radius) => [C + radius * Math.cos(angle(position)), C + radius * Math.sin(angle(position))];

/** SVG path for a clockwise arc from one ring position to another. */
function arc(from, to, radius) {
  let span = to - from;
  if (span < 0) span += 1;
  const [x0, y0] = point(from, radius);
  const [x1, y1] = point(from + span, radius);
  return `M${x0.toFixed(2)} ${y0.toFixed(2)} A${radius} ${radius} 0 ${span > 0.5 ? 1 : 0} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
}

const scatter = (position) => {
  const x = Math.sin(position * 7919.13 + 3.7) * 43758.5453;
  return x - Math.floor(x);
};

const QUARTERS = [
  [0, "0", "middle"],
  [0.25, "0.25", "start"],
  [0.5, "0.5", "middle"],
  [0.75, "0.75", "end"],
];

/**
 * The consistent-hash ring. The outer band is coloured by which node owns each stretch, the dots
 * inside are cached keys placed by their hash, and a located key draws a needle and a clockwise
 * walk to the nodes that hold it.
 */
export default function Ring({ ring, inkOf, keys, located, highlight, total, nodeCount }) {
  const arcs = useMemo(() => {
    if (!ring) return [];
    const healthy = new Map(ring.nodes.map((node) => [node.node, node.healthy !== false]));
    const tokens = ring.nodes.flatMap((node) => node.tokens.map((position) => ({ position, node: node.node })))
      .sort((a, b) => a.position - b.position);
    const result = [];
    tokens.forEach((token, index) => {
      const previous = tokens[(index - 1 + tokens.length) % tokens.length].position;
      const span = (token.position - previous + 1) % 1;
      if (tokens.length > 1 && span === 0) return;
      const start = span > 0.0016 ? previous + 0.0008 : previous;
      result.push({ d: arc(start, token.position, BAND_MID), node: token.node, up: healthy.get(token.node) });
    });
    return result;
  }, [ring]);

  const dots = useMemo(() => keys.map((entry) => {
    const owner = entry.owners?.[0] ?? entry.nodes?.[0];
    const [x, y] = point(entry.position, 212 + scatter(entry.position) * 46);
    return { key: entry.key, x, y, node: owner };
  }), [keys]);

  const ticks = useMemo(() => Array.from({ length: 96 }, (_, index) => {
    const major = index % 24 === 0;
    const [x0, y0] = point(index / 96, 309);
    const [x1, y1] = point(index / 96, major ? 322 : 315);
    return { x0, y0, x1, y1, major, index };
  }), []);

  const owners = located?.owners ?? [];
  const lastOwner = owners[owners.length - 1];
  const description = ring
    ? `Hash ring with ${ring.tokenCount} points across ${ring.nodes.length} nodes. ${int(total)} keys.`
    : "Hash ring, waiting for data.";

  return (
    <svg className="ring" viewBox="0 0 700 700" role="img" aria-label={description}>
      <title>{description}</title>
      <g className="ring-ticks">
        {ticks.map((tick) => <line key={tick.index} x1={tick.x0} y1={tick.y0} x2={tick.x1} y2={tick.y1} className={tick.major ? "major" : undefined} />)}
        {QUARTERS.map(([position, label, anchor]) => {
          const [x, y] = point(position, 338);
          return <text key={label} x={x} y={y + (position === 0.5 ? 6 : position === 0 ? 0 : 4)} textAnchor={anchor} className="ring-quarter">{label}</text>;
        })}
      </g>

      <g className="ring-band" strokeWidth={BAND}>
        {arcs.map((segment, index) => (
          <path
            key={index} d={segment.d} stroke={inkOf(segment.node).color}
            className={[segment.up ? "" : "down", highlight && highlight !== segment.node ? "dim" : ""].join(" ").trim() || undefined}
          />
        ))}
      </g>

      <g className="ring-keys">
        {dots.map((dot) => (
          <circle key={dot.key} cx={dot.x} cy={dot.y} r={3.2} fill={inkOf(dot.node).color}
            className={highlight && highlight !== dot.node ? "dim" : undefined} />
        ))}
      </g>

      {located && owners.length > 0 && (
        <g key={`${located.key}:${located.position}`} className="ring-locate">
          <path className="walk" d={arc(located.position, lastOwner.position, 262)} pathLength="1" />
          <line className="needle" pathLength="1"
            x1={point(located.position, 175)[0]} y1={point(located.position, 175)[1]}
            x2={point(located.position, 318)[0]} y2={point(located.position, 318)[1]} />
          <circle className="landing" cx={point(located.position, 318)[0]} cy={point(located.position, 318)[1]} r="7" />
          {owners.map((owner, index) => {
            const [x, y] = point(owner.position, BAND_MID - (index % 2) * 30);
            return (
              <g key={owner.node} className="owner" style={{ animationDelay: `${0.35 + index * 0.18}s` }}>
                <circle cx={x} cy={y} r="15" fill={inkOf(owner.node).color} />
                <text x={x} y={y + 5} textAnchor="middle">{index + 1}</text>
              </g>
            );
          })}
        </g>
      )}

      <g className="ring-readout" textAnchor="middle">
        <text x={C} y={located ? C - 8 : C + 2} className="ring-total">{int(total)}</text>
        <text x={C} y={located ? C + 24 : C + 34} className="ring-caption">{total === 1 ? "key" : "keys"} on {nodeCount} {nodeCount === 1 ? "node" : "nodes"}</text>
        {located && <text x={C} y={C + 52} className="ring-caption strong">{located.key.length > 22 ? `${located.key.slice(0, 21)}…` : located.key} lands at {located.position.toFixed(4)}</text>}
      </g>
    </svg>
  );
}
