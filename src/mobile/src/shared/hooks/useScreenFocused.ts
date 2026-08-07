import { useCallback, useState } from "react";
import { useFocusEffect } from "expo-router";

// State-based focus flag for gating subscriptions (a realtime doc attach must
// drop when another screen covers this one, since stacked screens stay
// mounted). For effects that only need to read focus, use useScreenFocusRef.
export function useScreenFocused(): boolean {
  const [focused, setFocused] = useState(true);
  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      return () => setFocused(false);
    }, []),
  );
  return focused;
}
