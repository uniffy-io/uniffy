import { effectiveDayKey, parseCalendarDate } from "@/shared/utils/dateFormatting";
import { getPreferredTimeZone } from "@/shared/utils/timezone";

export function formatMessageTime(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: getPreferredTimeZone() ?? undefined,
  });
}

export function formatMessageTimestamp(dateStr: string): string {
  const date = new Date(dateStr);
  const dayDiff = Math.round(
    (parseCalendarDate(effectiveDayKey(new Date())).getTime() -
      parseCalendarDate(effectiveDayKey(date)).getTime()) /
      86400000,
  );

  const time = formatMessageTime(dateStr);

  if (dayDiff <= 0) {
    return time;
  }
  if (dayDiff === 1) {
    return `Yesterday ${time}`;
  }
  const dateLabel = date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: getPreferredTimeZone() ?? undefined,
  });
  return `${dateLabel} ${time}`;
}
