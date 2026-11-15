import { useEffect, useState } from "react";

/** Re-render every `interval` ms with the current time, for live countdowns. */
export function useNow(interval = 1000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), interval);
    return () => clearInterval(timer);
  }, [interval]);
  return now;
}
