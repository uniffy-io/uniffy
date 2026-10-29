export function activityTime(seconds: number): string {
  const value = Math.max(0, Math.floor(seconds));
  return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, "0")}`;
}
export function activityCoverage(observed: number, present: number): string {
  return present
    ? `${Math.min(100, Math.round((observed / present) * 100))}% observed`
    : "Not attended";
}
export function activityDescription(
  bucket: {
    offsetSeconds: number;
    presentSeconds: number;
    observedSeconds: number;
    speakingSeconds: number;
  },
  resolution: number,
  duration: number,
): string {
  const range = `${activityTime(bucket.offsetSeconds)} to ${activityTime(Math.min(duration, bucket.offsetSeconds + resolution))}`;
  if (!bucket.presentSeconds) return `${range}. Not in call.`;
  if (!bucket.observedSeconds) return `${range}. Activity unavailable.`;
  const missing = Math.max(0, bucket.presentSeconds - bucket.observedSeconds);
  return `${range}. ${bucket.speakingSeconds}s speaking, ${bucket.observedSeconds - bucket.speakingSeconds}s quiet${missing ? `, ${missing}s unavailable` : ""}.`;
}

interface ActivitySample {
  offsetSeconds: number;
  presentSeconds: number;
  observedSeconds: number;
  speakingSeconds: number;
}
interface ActivityRun extends ActivitySample {
  durationSeconds: number;
}

// Keep inspection samples intact while combining visually identical neighbors.
export function activityRuns(
  samples: readonly ActivitySample[],
  resolution: number,
  duration: number,
): ActivityRun[] {
  const runs: ActivityRun[] = [];
  for (const sample of samples) {
    const span = Math.min(resolution, duration - sample.offsetSeconds);
    if (span <= 0) continue;
    const last = runs.at(-1);
    if (
      last &&
      last.offsetSeconds + last.durationSeconds === sample.offsetSeconds &&
      last.presentSeconds === sample.presentSeconds &&
      last.observedSeconds === sample.observedSeconds &&
      last.speakingSeconds === sample.speakingSeconds
    ) {
      last.durationSeconds += span;
    } else {
      runs.push({ ...sample, durationSeconds: span });
    }
  }
  return runs;
}
