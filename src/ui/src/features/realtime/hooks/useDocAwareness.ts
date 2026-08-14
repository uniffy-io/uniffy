import { useEffect, useState } from "react";
import type { Awareness } from "y-protocols/awareness";

export interface AwarenessPeer<T = Record<string, unknown>> {
  clientId: number;
  state: T;
}

export function useDocAwareness<T = Record<string, unknown>>(
  awareness: Awareness | null,
): AwarenessPeer<T>[] {
  const [peers, setPeers] = useState<AwarenessPeer<T>[]>([]);

  useEffect(() => {
    if (!awareness) {
      // eslint-disable-next-line react/react-compiler -- reset peers when awareness detaches
      setPeers([]);
      return;
    }

    const compute = (): AwarenessPeer<T>[] => {
      const out: AwarenessPeer<T>[] = [];
      awareness.getStates().forEach((state, clientId) => {
        if (clientId === awareness.clientID) return;
        out.push({ clientId, state: state as T });
      });
      return out;
    };

    setPeers(compute());

    const onChange = () => setPeers(compute());
    awareness.on("change", onChange);
    return () => {
      awareness.off("change", onChange);
    };
  }, [awareness]);

  return peers;
}

export function setLocalAwareness(
  awareness: Awareness | null,
  patch: Record<string, unknown>,
): void {
  if (!awareness) return;
  const current = awareness.getLocalState() ?? {};
  awareness.setLocalState({ ...current, ...patch });
}
