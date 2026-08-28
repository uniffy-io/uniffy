import { useCallback, useEffect, useState } from "react";
import { AppState } from "react-native";
import { getAudioOutputs, selectAudioOutput } from "@features/calls/livekit";
import { usePreferredAudioOutput } from "@features/calls/callPrefs";

export interface AudioRoute {
  id: string;
  label: string;
}

// Android reports physical routes; iOS only ever offers these two, because the
// OS routes everything else itself through the system picker.
const ROUTE_LABEL: Record<string, string> = {
  speaker: "Speaker",
  earpiece: "Phone",
  headset: "Wired headset",
  bluetooth: "Bluetooth",
  default: "Automatic",
  force_speaker: "Speaker",
};

function toRoute(id: string): AudioRoute {
  return { id, label: ROUTE_LABEL[id] ?? id };
}

/**
 * The route list is only meaningful while an audio session is running, and it
 * changes underneath the app when a headset is plugged in or a Bluetooth device
 * connects - hence the refresh on foreground rather than a one-shot read.
 */
export function useAudioOutputs(active: boolean): {
  outputs: AudioRoute[];
  selected: string | null;
  select: (deviceId: string) => void;
} {
  const [outputs, setOutputs] = useState<AudioRoute[]>([]);
  const [selected, setSelected] = usePreferredAudioOutput();

  const refresh = useCallback(async () => {
    const ids = await getAudioOutputs().catch(() => [] as string[]);
    setOutputs(ids.map(toRoute));
  }, []);

  // Nothing is cleared when this goes inactive: the list is only read while a
  // route surface is on screen, and dropping it would setState synchronously here
  // for no one's benefit.
  useEffect(() => {
    if (!active) return;
    // eslint-disable-next-line react/react-compiler -- refresh() reads the native route list asynchronously and backs the AppState subscription
    void refresh();
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") void refresh();
    });
    return () => subscription.remove();
  }, [active, refresh]);

  const select = useCallback(
    (deviceId: string) => {
      setSelected(deviceId);
      void selectAudioOutput(deviceId).catch(() => {});
    },
    [setSelected],
  );

  return { outputs, selected, select };
}
