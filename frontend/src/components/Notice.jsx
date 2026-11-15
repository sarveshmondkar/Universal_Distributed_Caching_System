import { useEffect } from "react";

export default function Notice({ notice, onDismiss }) {
  useEffect(() => {
    if (!notice) return undefined;
    const timer = setTimeout(onDismiss, notice.tone === "error" ? 9000 : 5000);
    return () => clearTimeout(timer);
  }, [notice, onDismiss]);

  return (
    <div className="notice-region" role="status" aria-live="polite">
      {notice && (
        <div className={`notice ${notice.tone}`}>
          <span>{notice.message}</span>
          <button className="btn btn-quiet" onClick={onDismiss}>Dismiss</button>
        </div>
      )}
    </div>
  );
}
