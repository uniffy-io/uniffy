import type { EventActivity } from "@/features/calendar/types";

/** Whose version the sync kept; null when the server did not say. */
export type SyncConflictWinner = "uniffy" | "provider";

export interface SyncConflict {
  /** The server's one-line account of what happened. */
  summary: string;
  winner: SyncConflictWinner | null;
  /** The fields the two versions disagreed on, in the server's order. */
  fields: string[];
  /** The values that lost, by field; kept so nothing is silently dropped. */
  replaced: Record<string, string>;
}

function parseObject(value: string | undefined): Record<string, unknown> {
  if (!value) return {};
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

/** Reads a sync-conflict activity; malformed values degrade to an empty account. */
export function parseSyncConflict(activity: EventActivity): SyncConflict {
  const previous = parseObject(activity.previousValue);
  const summary = typeof previous.summary === "string" ? previous.summary : "";
  const winner =
    previous.winner === "uniffy" || previous.winner === "provider" ? previous.winner : null;
  const fields = (activity.fieldId ?? "").split(",").filter(Boolean);
  const replaced: Record<string, string> = {};
  for (const field of fields) {
    const value = previous[field];
    if (typeof value === "string" && value) replaced[field] = value;
  }
  return { summary, winner, fields, replaced };
}

const REPLACED_TEXT_LIMIT = 140;

/** The replaced values in field order, long free text cut to one readable line. */
export function replacedEntries(conflict: SyncConflict): Array<[field: string, value: string]> {
  return conflict.fields
    .filter((field) => field in conflict.replaced)
    .map((field) => {
      const value = conflict.replaced[field].replace(/\s+/g, " ").trim();
      return [
        field,
        value.length > REPLACED_TEXT_LIMIT
          ? `${value.slice(0, REPLACED_TEXT_LIMIT - 1).trimEnd()}\u2026`
          : value,
      ];
    });
}
