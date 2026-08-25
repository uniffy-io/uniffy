import { useEffect, useSyncExternalStore } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { queryClient } from "@core/api/queryClient";

/**
 * Display timezone and week-start preferences from the member's settings
 * profile. Mirrors the web's `shared/utils/timezone.ts` + `weekStart.ts`:
 * module state so non-React code (serializers) can read it, listeners so
 * mounted screens re-render when the settings fetch lands.
 */

export type WeekStartDay = 0 | 1 | 6;

const WEEK_START_DAYS: Record<string, WeekStartDay> = {
  sunday: 0,
  monday: 1,
  saturday: 6,
};

const TIMEZONE_KEY = "uniffy_pref_timezone";
const WEEK_START_KEY = "uniffy_pref_week_start";

let preferredTimeZone: string | null = null;
let weekStart: string | null = null;
let loaded = false;
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getPreferredTimeZone(): string | null {
  return preferredTimeZone;
}

export function getDeviceTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

/** Always a concrete IANA zone: the stored preference, the device otherwise. */
export function getEffectiveTimeZone(): string {
  return preferredTimeZone ?? getDeviceTimeZone();
}

export function getWeekStartsOn(): WeekStartDay {
  return WEEK_START_DAYS[weekStart ?? ""] ?? 1;
}

/** Loads the cached preferences so calendar data serialized before the settings fetch already uses them. */
export async function loadDateTimePrefs(): Promise<void> {
  if (loaded) return;
  loaded = true;
  try {
    const [cachedTz, cachedWs] = await Promise.all([
      AsyncStorage.getItem(TIMEZONE_KEY),
      AsyncStorage.getItem(WEEK_START_KEY),
    ]);
    let changed = false;
    if (cachedTz && cachedTz !== preferredTimeZone) {
      preferredTimeZone = cachedTz;
      changed = true;
    }
    if (cachedWs && cachedWs in WEEK_START_DAYS && cachedWs !== weekStart) {
      weekStart = cachedWs;
      changed = true;
    }
    if (changed) notify();
  } catch {
    // Defaults (device zone, Monday) apply until the settings fetch lands.
  }
}

export function setDateTimePrefs(next: {
  timezone?: string | null;
  weekStart?: string | null;
}): void {
  let changed = false;
  let zoneChanged = false;
  if (next.timezone !== undefined) {
    const tz = next.timezone || null;
    if (tz !== preferredTimeZone) {
      preferredTimeZone = tz;
      changed = true;
      zoneChanged = true;
      if (tz) void AsyncStorage.setItem(TIMEZONE_KEY, tz).catch(() => {});
      else void AsyncStorage.removeItem(TIMEZONE_KEY).catch(() => {});
    }
  }
  if (next.weekStart !== undefined) {
    const ws = next.weekStart && next.weekStart in WEEK_START_DAYS ? next.weekStart : null;
    if (ws !== weekStart) {
      weekStart = ws;
      changed = true;
      if (ws) void AsyncStorage.setItem(WEEK_START_KEY, ws).catch(() => {});
      else void AsyncStorage.removeItem(WEEK_START_KEY).catch(() => {});
    }
  }
  if (!changed) return;
  notify();
  if (zoneChanged) {
    // Serialized events bake their formatted times at fetch, so a zone change
    // has to refetch them - a re-render alone would keep the stale strings.
    void queryClient.invalidateQueries({ queryKey: ["events-range"] });
    void queryClient.invalidateQueries({ queryKey: ["event"] });
  }
}

type DateTimePrefs = {
  timeZone: string;
  preferredTimeZone: string | null;
  weekStartsOn: WeekStartDay;
  weekStart: string | null;
};

let snapshotCache: DateTimePrefs | null = null;

function snapshot(): DateTimePrefs {
  if (
    !snapshotCache ||
    snapshotCache.preferredTimeZone !== preferredTimeZone ||
    snapshotCache.weekStart !== weekStart
  ) {
    snapshotCache = {
      timeZone: getEffectiveTimeZone(),
      preferredTimeZone,
      weekStartsOn: getWeekStartsOn(),
      weekStart,
    };
  }
  return snapshotCache;
}

export function useDateTimePrefs(): DateTimePrefs {
  useEffect(() => {
    void loadDateTimePrefs();
  }, []);
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}
