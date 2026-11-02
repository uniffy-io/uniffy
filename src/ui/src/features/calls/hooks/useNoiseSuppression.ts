import { useCallback, useState } from "react";
import { useAppDispatch, useAppSelector } from "@/app/hooks";
import {
  noiseSuppressionChanged,
  selectCallPreferences,
} from "@/features/calls/store/callPreferencesSlice";
import { noiseSuppressionSupported } from "@/features/calls/utils/noiseSuppression";

export const NOISE_SUPPRESSION_HINT =
  "Filters keyboard, fan and street noise from your microphone. Runs on this device.";
export const NOISE_SUPPRESSION_UNSUPPORTED_HINT =
  "Noise suppression is not supported in this browser.";

/** Saved preference; CallProvider applies changes to the live mic track. */
export function useNoiseSuppression() {
  const dispatch = useAppDispatch();
  const { noiseSuppression = true } = useAppSelector(selectCallPreferences);
  const [supported] = useState(noiseSuppressionSupported);
  const setEnabled = useCallback(
    (enabled: boolean) => dispatch(noiseSuppressionChanged(enabled)),
    [dispatch],
  );
  return { enabled: supported && noiseSuppression, supported, setEnabled };
}
