interface CameraDevice {
  isCameraEnabled: boolean;
  setCameraEnabled: (enabled: boolean) => Promise<unknown>;
}

export function createCameraContinuity(
  device: CameraDevice,
  changed: (enabled: boolean) => void,
  failed: (error: unknown) => void,
) {
  let foreground = true;
  let restore = false;
  let disposed = false;
  let pending = Promise.resolve();
  return {
    update(active: boolean) {
      foreground = active;
      pending = pending
        .then(async () => {
          if (disposed) return;
          if (!foreground && device.isCameraEnabled) {
            restore = true;
            await device.setCameraEnabled(false);
            if (!disposed) changed(false);
          } else if (foreground && restore) {
            restore = false;
            await device.setCameraEnabled(true);
            if (!disposed) changed(true);
          }
        })
        .catch((error) => {
          if (!disposed) failed(error);
        });
      return pending;
    },
    cancelRestore() {
      restore = false;
    },
    dispose() {
      disposed = true;
      restore = false;
    },
  };
}
