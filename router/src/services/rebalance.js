/**
 * Pure planning step for rebalancing. Given every entry found on every reachable node, work out
 * which copies are missing and which are surplus under the current ring.
 *
 * `holdings` is a Map of node URL -> [{ key, value, expiresAt }].
 * Nodes listed in `leaving` are read as sources but never receive writes or deletes.
 *
 * When replicas disagree about a value the copy held by the node that comes first in ring order
 * wins. There are no version vectors in this project, so that is a deterministic tiebreak, not a
 * correctness guarantee.
 */
export function planRebalance({ holdings, selector, replicationFactor, leaving = [], now = Date.now() }) {
  const leavingSet = new Set(leaving);
  const byKey = new Map();
  for (const [node, entries] of holdings) {
    for (const entry of entries) {
      if (entry.expiresAt != null && entry.expiresAt <= now) continue;
      if (!byKey.has(entry.key)) byKey.set(entry.key, new Map());
      byKey.get(entry.key).set(node, entry);
    }
  }

  const copies = [];
  const deletes = [];
  for (const [key, holders] of byKey) {
    const targets = selector.ordered(key).slice(0, replicationFactor);
    const preference = selector.ordered(key);
    const source = [...preference, ...holders.keys()].find((node) => holders.has(node));
    const entry = holders.get(source);
    const ttl = entry.expiresAt == null ? undefined : Math.max(1, entry.expiresAt - now);
    for (const node of targets) {
      if (!holders.has(node)) copies.push({ node, key, value: entry.value, ttl, from: source });
    }
    for (const node of holders.keys()) {
      if (!targets.includes(node) && !leavingSet.has(node)) deletes.push({ node, key });
    }
  }
  return { scanned: byKey.size, copies, deletes };
}
