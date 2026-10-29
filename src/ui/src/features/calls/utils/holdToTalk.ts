/** Serializes release behind microphone activation, including slow permission prompts. */
export function createHoldToTalk(setEnabled: (enabled: boolean) => Promise<unknown>) {
  let held = false;
  let pending = Promise.resolve();
  const apply = (enabled: boolean) => {
    pending = pending
      .then(() => setEnabled(enabled))
      .then(
        () => {},
        () => {},
      );
    return pending;
  };
  return {
    press(muted: boolean) {
      if (held || !muted) return pending;
      held = true;
      return apply(true);
    },
    release() {
      if (!held) return pending;
      held = false;
      return apply(false);
    },
  };
}
