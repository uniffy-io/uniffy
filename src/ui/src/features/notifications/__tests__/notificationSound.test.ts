import { describe, expect, it } from "vitest";
import {
  clockMinutes,
  isWithinQuietHours,
  minutesOfDayInZone,
  shouldPlayNotificationSound,
  type NotificationSoundContext,
} from "@/features/notifications/utils/notificationSound";

const utc = (iso: string) => new Date(iso);

function context(overrides: Partial<NotificationSoundContext> = {}): NotificationSoundContext {
  return {
    soundEnabled: true,
    activelyViewingChat: false,
    presenceStatus: "online",
    quietHoursStart: undefined,
    quietHoursEnd: undefined,
    timezone: null,
    ...overrides,
  };
}

describe("clockMinutes", () => {
  it("parses strict zero-padded HH:MM", () => {
    expect(clockMinutes("00:00")).toBe(0);
    expect(clockMinutes("22:00")).toBe(1320);
    expect(clockMinutes("23:59")).toBe(1439);
  });

  it("rejects malformed values", () => {
    expect(clockMinutes("9:00")).toBeNull();
    expect(clockMinutes("24:00")).toBeNull();
    expect(clockMinutes("12:60")).toBeNull();
    expect(clockMinutes("aa:bb")).toBeNull();
    expect(clockMinutes("")).toBeNull();
    expect(clockMinutes(undefined)).toBeNull();
  });
});

describe("minutesOfDayInZone", () => {
  it("converts an instant into the profile timezone", () => {
    // 20:30 UTC is 23:30 in Sofia (EEST) and 16:30 in New York (EDT).
    const at = utc("2026-08-21T20:30:00Z");
    expect(minutesOfDayInZone(at, "Europe/Sofia")).toBe(23 * 60 + 30);
    expect(minutesOfDayInZone(at, "America/New_York")).toBe(16 * 60 + 30);
  });

  it("falls back to UTC for a missing or invalid timezone", () => {
    const at = utc("2026-08-21T20:30:00Z");
    expect(minutesOfDayInZone(at, null)).toBe(20 * 60 + 30);
    expect(minutesOfDayInZone(at, "")).toBe(20 * 60 + 30);
    expect(minutesOfDayInZone(at, "Not/AZone")).toBe(20 * 60 + 30);
  });
});

describe("isWithinQuietHours", () => {
  it("covers a same-day window with inclusive start and exclusive end", () => {
    const window = (iso: string) => isWithinQuietHours("09:00", "17:00", null, utc(iso));
    expect(window("2026-08-21T08:59:00Z")).toBe(false);
    expect(window("2026-08-21T09:00:00Z")).toBe(true);
    expect(window("2026-08-21T16:59:00Z")).toBe(true);
    expect(window("2026-08-21T17:00:00Z")).toBe(false);
  });

  it("covers an overnight window on both sides of midnight", () => {
    const window = (iso: string) => isWithinQuietHours("22:00", "08:00", null, utc(iso));
    expect(window("2026-08-21T21:59:00Z")).toBe(false);
    expect(window("2026-08-21T22:00:00Z")).toBe(true);
    expect(window("2026-08-21T23:59:00Z")).toBe(true);
    expect(window("2026-08-22T00:00:00Z")).toBe(true);
    expect(window("2026-08-22T07:59:00Z")).toBe(true);
    expect(window("2026-08-22T08:00:00Z")).toBe(false);
    expect(window("2026-08-22T12:00:00Z")).toBe(false);
  });

  it("evaluates the window in the profile timezone", () => {
    const at = utc("2026-08-21T20:30:00Z");
    expect(isWithinQuietHours("22:00", "08:00", "Europe/Sofia", at)).toBe(true);
    expect(isWithinQuietHours("22:00", "08:00", "America/New_York", at)).toBe(false);
    expect(isWithinQuietHours("22:00", "08:00", null, at)).toBe(false);
  });

  it("uses UTC when the timezone is invalid", () => {
    expect(isWithinQuietHours("22:00", "08:00", "Not/AZone", utc("2026-08-21T23:30:00Z"))).toBe(
      true,
    );
    expect(isWithinQuietHours("22:00", "08:00", "Not/AZone", utc("2026-08-21T12:00:00Z"))).toBe(
      false,
    );
  });

  it("never matches for equal or malformed times", () => {
    const at = utc("2026-08-21T10:00:00Z");
    expect(isWithinQuietHours("10:00", "10:00", null, at)).toBe(false);
    expect(isWithinQuietHours("9:00", "17:00", null, at)).toBe(false);
    expect(isWithinQuietHours("22:00", undefined, null, at)).toBe(false);
    expect(isWithinQuietHours("", "", null, at)).toBe(false);
  });
});

describe("shouldPlayNotificationSound", () => {
  const midday = utc("2026-08-21T12:00:00Z");

  it("plays for an ordinary notification", () => {
    expect(shouldPlayNotificationSound(context(), midday)).toBe(true);
  });

  it("respects the sound preference", () => {
    expect(shouldPlayNotificationSound(context({ soundEnabled: false }), midday)).toBe(false);
  });

  it("suppresses while presence is DND", () => {
    expect(shouldPlayNotificationSound(context({ presenceStatus: "dnd" }), midday)).toBe(false);
  });

  it("plays when presence is unknown", () => {
    expect(shouldPlayNotificationSound(context({ presenceStatus: undefined }), midday)).toBe(true);
  });

  it("suppresses for the actively viewed chat", () => {
    expect(shouldPlayNotificationSound(context({ activelyViewingChat: true }), midday)).toBe(false);
  });

  it("suppresses during quiet hours in the profile timezone", () => {
    const at = utc("2026-08-21T20:30:00Z");
    const quiet = context({
      quietHoursStart: "22:00",
      quietHoursEnd: "08:00",
      timezone: "Europe/Sofia",
    });
    expect(shouldPlayNotificationSound(quiet, at)).toBe(false);
    expect(shouldPlayNotificationSound({ ...quiet, timezone: null }, at)).toBe(true);
  });

  it("decides without any toast inputs, so toast settings stay independent", () => {
    const settings = { toastEnabled: false, soundEnabled: true };
    expect(
      shouldPlayNotificationSound(context({ soundEnabled: settings.soundEnabled }), midday),
    ).toBe(true);
  });
});
