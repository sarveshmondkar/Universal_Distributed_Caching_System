import { createHash } from "node:crypto";

const digest = (value) => createHash("sha256").update(value).digest("hex");

/** Map a hex digest to a position on the ring in [0, 1). Uses the first 32 bits. */
export const positionOfDigest = (hex) => parseInt(hex.slice(0, 8), 16) / 2 ** 32;

/**
 * Consistent-hash ring with virtual nodes.
 *
 * Every physical node owns `virtualNodes` points on the ring. A key hashes to a point and is
 * owned by the first virtual node found walking clockwise; the next *distinct* nodes along the
 * walk are its replicas.
 */
export class NodeSelector {
  constructor(nodes = [], virtualNodes = 100) {
    this.nodes = [...new Set(nodes.map((node) => node.replace(/\/$/, "")))];
    this.virtualNodes = virtualNodes;
    this.ring = [];
    for (const node of this.nodes) {
      for (let i = 0; i < virtualNodes; i++) {
        const point = digest(`${node}#${i}`);
        this.ring.push({ point, position: positionOfDigest(point), node });
      }
    }
    // Hex digests are lowercase [0-9a-f], so plain comparison gives a stable total order.
    this.ring.sort((a, b) => (a.point < b.point ? -1 : a.point > b.point ? 1 : 0));
  }

  /** Index of the first ring point at or after `point` (wraps to 0). O(log n). */
  _startIndex(point) {
    let low = 0;
    let high = this.ring.length;
    while (low < high) {
      const mid = (low + high) >>> 1;
      if (this.ring[mid].point < point) low = mid + 1;
      else high = mid;
    }
    return low === this.ring.length ? 0 : low;
  }

  /** Where a key lands on the ring. */
  locate(key) {
    const hash = digest(key);
    return { hash, position: positionOfDigest(hash) };
  }

  /**
   * Distinct nodes in clockwise order from the key, each with the ring position of the first
   * virtual node that claimed it. The first entry is the primary owner.
   */
  walk(key) {
    if (!this.ring.length) return [];
    const { hash } = this.locate(key);
    const start = this._startIndex(hash);
    const seen = new Set();
    const result = [];
    for (let offset = 0; offset < this.ring.length && seen.size < this.nodes.length; offset++) {
      const entry = this.ring[(start + offset) % this.ring.length];
      if (seen.has(entry.node)) continue;
      seen.add(entry.node);
      result.push({ node: entry.node, position: entry.position });
    }
    return result;
  }

  /** Distinct node URLs in preference order. The first is the primary owner. */
  ordered(key) {
    return this.walk(key).map((entry) => entry.node);
  }

  /** Ring geometry for the dashboard: every token plus the share of the ring each node owns. */
  snapshot() {
    const total = this.ring.length;
    const nodes = new Map(this.nodes.map((node) => [node, { node, tokens: [], share: 0 }]));
    for (let i = 0; i < total; i++) {
      const entry = this.ring[i];
      // A token owns the arc between the previous token (exclusive) and itself (inclusive).
      const previous = this.ring[(i - 1 + total) % total].position;
      const arc = i === 0 ? entry.position + 1 - previous : entry.position - previous;
      const record = nodes.get(entry.node);
      record.tokens.push(Number(entry.position.toFixed(5)));
      record.share += total === 1 ? 1 : arc;
    }
    return {
      virtualNodes: this.virtualNodes,
      tokenCount: total,
      nodes: [...nodes.values()].map((record) => ({ ...record, share: Number(record.share.toFixed(5)) })),
    };
  }
}

export function configuredNodes() {
  return (process.env.CACHE_NODES || process.env.CACHE_NODE || "http://localhost:4001")
    .split(",").map((node) => node.trim()).filter(Boolean);
}
