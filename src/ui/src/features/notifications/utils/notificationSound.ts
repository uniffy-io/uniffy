const CLOCK_RE = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const PRESENCE_STATUS_DND = "dnd";

export function clockMinutes(value: string | undefined): number | null {
  if (!value || !CLOCK_RE.test(value)) return null;
  const [hour, minute] = value.split(":").map(Number);
  return hour * 60 + minute;
}

function zoneFormatter(timeZone: string): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
}

export function minutesOfDayInZone(at: Date, timezone: string | null | undefined): number {
  let formatter: Intl.DateTimeFormat;
  try {
    formatter = zoneFormatter(timezone || "UTC");
  } catch {
    formatter = zoneFormatter("UTC");
  }
  const parts = formatter.formatToParts(at);
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
  return hour * 60 + minute;
}

export function isWithinQuietHours(
  start: string | undefined,
  end: string | undefined,
  timezone: string | null | undefined,
  at: Date,
): boolean {
  const startMinutes = clockMinutes(start);
  const endMinutes = clockMinutes(end);
  if (startMinutes === null || endMinutes === null || startMinutes === endMinutes) {
    return false;
  }
  const current = minutesOfDayInZone(at, timezone);
  if (startMinutes < endMinutes) {
    return startMinutes <= current && current < endMinutes;
  }
  return current >= startMinutes || current < endMinutes;
}

export interface NotificationSoundContext {
  soundEnabled: boolean;
  activelyViewingChat: boolean;
  presenceStatus: string | undefined;
  quietHoursStart: string | undefined;
  quietHoursEnd: string | undefined;
  timezone: string | null | undefined;
}

export function shouldPlayNotificationSound(
  ctx: NotificationSoundContext,
  at: Date = new Date(),
): boolean {
  if (!ctx.soundEnabled || ctx.activelyViewingChat) return false;
  if (ctx.presenceStatus === PRESENCE_STATUS_DND) return false;
  return !isWithinQuietHours(ctx.quietHoursStart, ctx.quietHoursEnd, ctx.timezone, at);
}

let audioContext: AudioContext | null = null;

/** Synthesizes a local chime while keeping audio failures outside notification delivery. */
export function playNotificationSound(): void {
  try {
    audioContext ??= new AudioContext();
    const ctx = audioContext;
    void ctx
      .resume()
      .then(() => {
        const t = ctx.currentTime + 0.02;
        const gain = ctx.createGain();
        gain.connect(ctx.destination);
        gain.gain.setValueAtTime(0.08, t);
        gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
        const osc = ctx.createOscillator();
        osc.type = "sine";
        osc.frequency.setValueAtTime(880, t);
        osc.frequency.setValueAtTime(1174.66, t + 0.12);
        osc.connect(gain);
        osc.start(t);
        osc.stop(t + 0.4);
      })
      .catch(() => {});
  } catch {
    // WebAudio unavailable or blocked; the notification still lands.
  }
}
