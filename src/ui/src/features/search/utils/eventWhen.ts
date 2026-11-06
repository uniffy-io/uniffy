import { formatInTimeZone } from "date-fns-tz";
import { formatDateFull, formatDateTimeFull } from "@/shared/utils/dateFormatting";

/** When a calendar event hit happens, so a yearly holiday's hits read apart. */
export function eventWhen(metadata: Record<string, string>): string {
  const start = metadata["start_time"];
  if (!start) return "";
  const instant = new Date(start);
  if (Number.isNaN(instant.getTime())) return "";
  if (metadata["is_all_day"] !== "true") return formatDateTimeFull(start);
  // An all-day event names a date in its own zone, whatever zone the viewer is in.
  try {
    return formatDateFull(formatInTimeZone(instant, metadata["timezone"] || "UTC", "yyyy-MM-dd"));
  } catch {
    return formatDateFull(start);
  }
}
