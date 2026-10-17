import { useEffect, useState } from "react";

export function useInitialSync(whenSynced: Promise<void> | undefined): boolean {
  const [completed, setCompleted] = useState<Promise<void> | null>(null);
  useEffect(() => {
    if (!whenSynced) return;
    let cancelled = false;
    void whenSynced.then(() => {
      if (!cancelled) setCompleted(whenSynced);
    });
    return () => {
      cancelled = true;
    };
  }, [whenSynced]);
  return whenSynced !== undefined && completed === whenSynced;
}
