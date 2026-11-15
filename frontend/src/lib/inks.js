import { useRef } from "react";

/**
 * Node colours. Each is about 3:1 against both the navy ring plate and the page background, and
 * every place that uses one also prints the node's name, so colour is never the only signal.
 */
export const INKS = [
  { color: "#0A988C", name: "teal" },
  { color: "#E5568A", name: "rose" },
  { color: "#6F7FF2", name: "periwinkle" },
  { color: "#6A9A1B", name: "green" },
  { color: "#DE6217", name: "orange" },
  { color: "#A66BE8", name: "violet" },
];

/** Assign colours by first appearance so a node keeps its colour when others come and go. */
export function useInks(nodeUrls) {
  const assigned = useRef(new Map());
  const map = assigned.current;
  for (const url of [...map.keys()]) if (!nodeUrls.includes(url)) map.delete(url);
  for (const url of nodeUrls) {
    if (map.has(url)) continue;
    const used = new Set(map.values());
    let index = 0;
    while (used.has(index) && index < INKS.length) index++;
    map.set(url, index % INKS.length);
  }
  return (url) => INKS[map.get(url) ?? 0];
}
