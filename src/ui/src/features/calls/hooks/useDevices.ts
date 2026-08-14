import { useCallback, useEffect, useMemo, useState } from "react";

/** Live device inventory; labels stay empty until a getUserMedia grant. */
export function useDevices() {
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);

  const refresh = useCallback(async () => {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    try {
      setDevices(await navigator.mediaDevices.enumerateDevices());
    } catch {
      setDevices([]);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- refresh() reads navigator.mediaDevices asynchronously and backs the devicechange subscription
    void refresh();
    const media = navigator.mediaDevices;
    if (!media?.addEventListener) return;
    const onChange = () => void refresh();
    media.addEventListener("devicechange", onChange);
    return () => media.removeEventListener("devicechange", onChange);
  }, [refresh]);

  return useMemo(
    () => ({
      audioInputs: devices.filter((d) => d.kind === "audioinput"),
      videoInputs: devices.filter((d) => d.kind === "videoinput"),
      audioOutputs: devices.filter((d) => d.kind === "audiooutput"),
      refresh,
    }),
    [devices, refresh],
  );
}
