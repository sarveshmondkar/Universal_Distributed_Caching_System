import { nodeHost, nodeShort } from "../lib/format.js";

/** A node's name with its ring colour. Colour is decoration; the name carries the meaning. */
export default function NodeTag({ url, ink, down = false }) {
  return (
    <span className={`node-tag${down ? " is-down" : ""}`} title={nodeHost(url)}>
      <i style={{ background: ink.color }} aria-hidden="true" />
      {nodeShort(url)}
    </span>
  );
}
