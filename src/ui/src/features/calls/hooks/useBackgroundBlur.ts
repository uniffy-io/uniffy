import { useCallback, useEffect, useState } from "react";
import { useAppDispatch, useAppSelector } from "@/app/hooks";
import { useCall } from "@/features/calls/components/callContext";
import {
  backgroundBlurStrengthChanged,
  selectCallPreferences,
} from "@/features/calls/store/callPreferencesSlice";
import { DEFAULT_BLUR_STRENGTH, type BlurStrength } from "@/features/calls/utils/blurStrength";

export const BLUR_COST_HINT =
  "Hide your surroundings on camera. Runs on this device and uses more battery.";
export const BLUR_UNSUPPORTED_HINT = "Background blur is not supported in this browser.";
export const BLUR_STRENGTH_HINT = "Stronger blur hides more of the room.";

/** Saved blur preference plus browser support, probed through the lazily loaded processor chunk. */
export function useBackgroundBlur() {
  const dispatch = useAppDispatch();
  const { backgroundBlur = false, backgroundBlurStrength = DEFAULT_BLUR_STRENGTH } =
    useAppSelector(selectCallPreferences);
  const { setBackgroundBlur } = useCall();
  const [supported, setSupported] = useState<boolean | null>(null);
  useEffect(() => {
    let cancelled = false;
    void import("@/features/calls/utils/blurProcessor")
      .then((module) => {
        if (!cancelled) setSupported(module.blurSupported());
      })
      .catch(() => {
        if (!cancelled) setSupported(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);
  const setBlur = useCallback(
    (enabled: boolean) => {
      if (!enabled || supported) void setBackgroundBlur(enabled);
    },
    [supported, setBackgroundBlur],
  );
  const setStrength = useCallback(
    (strength: BlurStrength) => dispatch(backgroundBlurStrengthChanged(strength)),
    [dispatch],
  );
  // A saved blur stays switchable off even where the browser cannot run it.
  return {
    blur: backgroundBlur,
    supported,
    available: backgroundBlur || supported === true,
    setBlur,
    strength: backgroundBlurStrength,
    setStrength,
  };
}
