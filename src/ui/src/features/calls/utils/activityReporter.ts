export interface ActivityChunk {
  offsetSeconds: number;
  observedMask: number;
  speakingMask: number;
}
interface ActivityReply {
  participantId: string;
  elapsedSeconds: number;
}
interface ActivityReporterOptions {
  report: (participantId: string, chunks: ActivityChunk[]) => Promise<ActivityReply>;
  sample: () => { connected: boolean; speaking: boolean };
  now?: () => number;
}

// Sample only the current second. A suspended timer must never fill its missing time as silence.
export function startActivityReporter({
  report,
  sample,
  now = () => performance.now(),
}: ActivityReporterOptions): () => void {
  const chunks = new Map<number, ActivityChunk>();
  let participantId = "";
  let anchor = 0;
  let elapsed = 0;
  let stopped = false;
  let inFlight = false;
  let flushAfterFlight = false;
  const position = () => Math.max(0, Math.floor(elapsed + (now() - anchor) / 1000));
  const observe = () => {
    if (!participantId || stopped) return;
    const state = sample();
    const second = position();
    for (const offset of chunks.keys()) if (offset + 30 <= second - 120) chunks.delete(offset);
    if (!state.connected) return;
    const offsetSeconds = Math.floor(second / 30) * 30;
    const bit = 1 << (second % 30);
    const chunk = chunks.get(offsetSeconds) ?? { offsetSeconds, observedMask: 0, speakingMask: 0 };
    chunk.observedMask |= bit;
    if (state.speaking) chunk.speakingMask |= bit;
    chunks.set(offsetSeconds, chunk);
  };
  const flush = async () => {
    if (inFlight) {
      flushAfterFlight = true;
      return;
    }
    if (stopped && !participantId) return;
    inFlight = true;
    try {
      if (!participantId) {
        const reply = await report("", []);
        if (stopped) return;
        participantId = reply.participantId;
        elapsed = reply.elapsedSeconds;
        anchor = now();
        observe();
      } else if (chunks.size) {
        await report(
          participantId,
          [...chunks.values()].map((chunk) => ({ ...chunk })),
        );
      }
    } catch {
      // Activity is best-effort. Retry the bounded buffer without interrupting media.
    } finally {
      inFlight = false;
      if (flushAfterFlight) {
        flushAfterFlight = false;
        void flush();
      }
    }
  };
  const sampleTimer = setInterval(observe, 1000);
  const flushTimer = setInterval(() => void flush(), 15000);
  void flush();
  return () => {
    if (stopped) return;
    observe();
    stopped = true;
    clearInterval(sampleTimer);
    clearInterval(flushTimer);
    void flush();
  };
}
