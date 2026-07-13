import { useCallback, useRef } from "react";
import { useFocusEffect } from "expo-router";

// Ref-based focus flag for effects reacting to global state (e.g. the
// pending @ reference): stacked screens stay mounted, so without this a
// reference picked on the focused screen is also consumed by the ones
// beneath it.
export function useScreenFocusRef() {
  const focusedRef = useRef(true);
  useFocusEffect(
    useCallback(() => {
      focusedRef.current = true;
      return () => {
        focusedRef.current = false;
      };
    }, []),
  );
  return focusedRef;
}
