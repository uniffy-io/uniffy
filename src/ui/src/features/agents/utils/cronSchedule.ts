export type Frequency = "minutes" | "hourly" | "daily" | "weekly" | "monthly";

export interface ScheduleConfig {
  frequency: Frequency;
  minuteInterval: number;
  hour: number;
  minute: number;
  weekdays: number[];
  monthDay: number;
}

export const DEFAULT_SCHEDULE: ScheduleConfig = {
  frequency: "daily",
  minuteInterval: 30,
  hour: 9,
  minute: 0,
  weekdays: [1, 2, 3, 4, 5],
  monthDay: 1,
};

export const FREQUENCY_OPTIONS = [
  { value: "minutes" as Frequency, label: "Every X minutes" },
  { value: "hourly" as Frequency, label: "Every hour" },
  { value: "daily" as Frequency, label: "Daily" },
  { value: "weekly" as Frequency, label: "Weekly" },
  { value: "monthly" as Frequency, label: "Monthly" },
];

export const MINUTE_INTERVAL_OPTIONS = [
  { value: 5, label: "5 minutes" },
  { value: 10, label: "10 minutes" },
  { value: 15, label: "15 minutes" },
  { value: 30, label: "30 minutes" },
];

export const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export const MONTH_DAY_OPTIONS = Array.from({ length: 31 }, (_, i) => ({
  value: i + 1,
  label: `${i + 1}${ordinalSuffix(i + 1)}`,
}));

export const HOUR_OPTIONS = Array.from({ length: 24 }, (_, i) => ({
  value: i,
  label: formatHour(i),
}));

export const MINUTE_OPTIONS = [
  { value: 0, label: ":00" },
  { value: 15, label: ":15" },
  { value: 30, label: ":30" },
  { value: 45, label: ":45" },
];

export const TIMEZONE_OPTIONS = [
  { value: "UTC", label: "UTC" },
  { value: "America/New_York", label: "US Eastern" },
  { value: "America/Chicago", label: "US Central" },
  { value: "America/Denver", label: "US Mountain" },
  { value: "America/Los_Angeles", label: "US Pacific" },
  { value: "Europe/London", label: "London" },
  { value: "Europe/Berlin", label: "Berlin" },
  { value: "Europe/Paris", label: "Paris" },
  { value: "Asia/Tokyo", label: "Tokyo" },
  { value: "Asia/Shanghai", label: "Shanghai" },
  { value: "Australia/Sydney", label: "Sydney" },
];

export function ordinalSuffix(n: number): string {
  if (n >= 11 && n <= 13) return "th";
  switch (n % 10) {
    case 1:
      return "st";
    case 2:
      return "nd";
    case 3:
      return "rd";
    default:
      return "th";
  }
}

export function formatHour(h: number): string {
  if (h === 0) return "12 AM";
  if (h === 12) return "12 PM";
  return h < 12 ? `${h} AM` : `${h - 12} PM`;
}

export function scheduleToCron(config: ScheduleConfig): string {
  switch (config.frequency) {
    case "minutes":
      return `*/${config.minuteInterval} * * * *`;
    case "hourly":
      return `${config.minute} * * * *`;
    case "daily":
      return `${config.minute} ${config.hour} * * *`;
    case "weekly": {
      const days =
        config.weekdays.length > 0 ? config.weekdays.sort((a, b) => a - b).join(",") : "*";
      return `${config.minute} ${config.hour} * * ${days}`;
    }
    case "monthly":
      return `${config.minute} ${config.hour} ${config.monthDay} * *`;
  }
}

export function cronToHuman(cron: string): string {
  const parts = cron.split(" ");
  if (parts.length !== 5) return cron;
  const [min, hour, dom, , dow] = parts;

  if (min.startsWith("*/") && hour === "*") {
    return `Every ${min.slice(2)} minutes`;
  }
  if (hour === "*" && dom === "*" && dow === "*") {
    return min === "0" ? "Every hour" : `Every hour at :${min.padStart(2, "0")}`;
  }

  const timeStr = formatHour(Number(hour)) + (Number(min) > 0 ? `:${min.padStart(2, "0")}` : "");

  if (dom !== "*" && dow === "*") {
    return `${dom}${ordinalSuffix(Number(dom))} of every month at ${timeStr}`;
  }

  if (dow !== "*" && dom === "*") {
    const dayNames = dow.split(",").map((d) => {
      const num = Number(d);
      if (d.includes("-")) {
        const [start, end] = d.split("-").map(Number);
        if (start === 1 && end === 5) return "weekdays";
        if (start === 0 && end === 6) return "every day";
        return `${WEEKDAY_LABELS[start]}-${WEEKDAY_LABELS[end]}`;
      }
      return WEEKDAY_LABELS[num] ?? d;
    });
    if (dayNames.length === 1 && dayNames[0] === "weekdays") {
      return `Weekdays at ${timeStr}`;
    }
    if (dayNames.length === 7 || (dayNames.length === 1 && dayNames[0] === "every day")) {
      return `Daily at ${timeStr}`;
    }
    return `${dayNames.join(", ")} at ${timeStr}`;
  }

  if (dom === "*" && dow === "*") {
    return `Daily at ${timeStr}`;
  }

  return cron;
}
