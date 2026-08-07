import { useCallback, useState } from "react";
import { useFocusEffect, useNavigation } from "expo-router";

// State-based focus flag for gating subscriptions (a realtime doc attach must
// drop when another screen covers this one, since stacked screens stay
// mounted). For effects that only need to read focus, use useScreenFocusRef.
export function useScreenFocused(): boolean {
  const navigation = useNavigation();
  // Seed from the real navigation state: useFocusEffect only fires when the
  // screen GAINS focus, so a screen mounted already-covered (double-tap push,
  // state restore) would otherwise report focused forever and, e.g.,
  // double-attach its realtime doc.
  const [focused, setFocused] = useState(() => navigation.isFocused());
  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      return () => setFocused(false);
    }, []),
  );
  return focused;
}
