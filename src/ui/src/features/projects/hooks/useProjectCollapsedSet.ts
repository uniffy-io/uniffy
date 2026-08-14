import { useCallback, useEffect, useRef, useState } from "react";

const storageKey = (scope: string, projectId: string) => `projects:${scope}:${projectId}`;

function loadSet(scope: string, projectId: string): Set<string> {
  if (typeof window === "undefined" || !projectId) return new Set();
  try {
    const raw = window.localStorage.getItem(storageKey(scope, projectId));
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((v): v is string => typeof v === "string"));
  } catch {
    return new Set();
  }
}

/** Persists a Set per (scope, projectId) in localStorage; reloads on key change. */
export function useProjectCollapsedSet(scope: string, projectId: string) {
  const [set, setSet] = useState<Set<string>>(() => loadSet(scope, projectId));
  const lastKeyRef = useRef(storageKey(scope, projectId));

  useEffect(() => {
    const key = storageKey(scope, projectId);
    if (key === lastKeyRef.current) return;
    lastKeyRef.current = key;
    setSet(loadSet(scope, projectId));
  }, [scope, projectId]);

  const persist = useCallback(
    (next: Set<string>) => {
      if (typeof window === "undefined") return;
      try {
        window.localStorage.setItem(storageKey(scope, projectId), JSON.stringify(Array.from(next)));
      } catch {
        // ignore quota / private-mode errors
      }
    },
    [scope, projectId],
  );

  const toggle = useCallback(
    (id: string) => {
      setSet((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        persist(next);
        return next;
      });
    },
    [persist],
  );

  const add = useCallback(
    (id: string) => {
      setSet((prev) => {
        if (prev.has(id)) return prev;
        const next = new Set(prev);
        next.add(id);
        persist(next);
        return next;
      });
    },
    [persist],
  );

  const has = useCallback((id: string) => set.has(id), [set]);

  return { has, toggle, add, set };
}
