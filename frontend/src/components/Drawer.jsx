import { useEffect, useRef } from "react";

/** Side panel for inspecting one thing. Closes on Escape or a click outside, and returns focus. */
export default function Drawer({ title, onClose, children }) {
  const closeRef = useRef(null);

  useEffect(() => {
    const opener = document.activeElement;
    closeRef.current?.focus();
    const onKey = (event) => { if (event.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("keydown", onKey); opener?.focus?.(); };
  }, [onClose]);

  return (
    <>
      <div className="scrim" onClick={onClose} />
      <aside className="drawer" role="dialog" aria-modal="true" aria-labelledby="drawer-title">
        <header className="drawer-head">
          <h2 id="drawer-title" className="mono">{title}</h2>
          <button ref={closeRef} className="btn btn-quiet" onClick={onClose}>Close</button>
        </header>
        <div className="drawer-body">{children}</div>
      </aside>
    </>
  );
}
