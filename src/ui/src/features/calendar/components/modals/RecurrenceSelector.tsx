import { useState } from "react";
import { ArrowsClockwise } from "@phosphor-icons/react";
import { cn } from "@/shared/utils/cn";
import { Select } from "@/components/ui/select";
import { DatePicker } from "@/components/ui/date-picker";
import { NumberInput } from "@/components/ui/number-input";
import type { RecurrenceConfig, RecurrencePattern, DayOfWeek } from "@/features/calendar/types";
import { RECURRENCE_LABELS, DAY_OF_WEEK_LABELS } from "@/features/calendar/constants";

type EndCondition = "never" | "after" | "on_date";

const ALL_DAYS: DayOfWeek[] = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
];

const PATTERN_OPTIONS = (Object.keys(RECURRENCE_LABELS) as RecurrencePattern[]).map((pattern) => ({
  value: pattern,
  label: RECURRENCE_LABELS[pattern],
}));

const DAY_KEYS = Object.keys(DAY_OF_WEEK_LABELS) as DayOfWeek[];

function getTodayDayOfWeek(): DayOfWeek {
  const jsDay = new Date().getDay();
  const mapping: DayOfWeek[] = [
    "sunday",
    "monday",
    "tuesday",
    "wednesday",
    "thursday",
    "friday",
    "saturday",
  ];
  return mapping[jsDay];
}

function getIntervalUnit(pattern: RecurrencePattern): string {
  switch (pattern) {
    case "daily":
      return "day(s)";
    case "weekly":
    case "biweekly":
      return "week(s)";
    case "monthly":
      return "month(s)";
    case "yearly":
      return "year(s)";
    default:
      return "";
  }
}

function getEndCondition(config: RecurrenceConfig): EndCondition {
  if (config.maxOccurrences) return "after";
  if (config.endDate) return "on_date";
  return "never";
}

function getDefaultDays(newPattern: RecurrencePattern): DayOfWeek[] | undefined {
  if (newPattern === "daily") return [...ALL_DAYS];
  if (newPattern === "weekly" || newPattern === "biweekly") return [getTodayDayOfWeek()];
  return undefined;
}

const INPUT_CLASS = "h-auto w-16 px-2 py-1 text-xs text-foreground text-center transition-all";

interface RecurrenceSelectorProps {
  value: RecurrenceConfig | undefined;
  onChange: (config: RecurrenceConfig | undefined) => void;
}

export function RecurrenceSelector({ value, onChange }: RecurrenceSelectorProps) {
  const pattern = value?.pattern ?? "none";

  const [endCondition, setEndCondition] = useState<EndCondition>(() =>
    value ? getEndCondition(value) : "never",
  );

  const handlePatternChange = (newPattern: RecurrencePattern) => {
    if (newPattern === "none") {
      onChange(undefined);
      setEndCondition("never");
      return;
    }

    onChange({
      pattern: newPattern,
      interval: newPattern === "biweekly" ? 2 : (value?.interval ?? 1),
      daysOfWeek: getDefaultDays(newPattern),
      dayOfMonth: newPattern === "monthly" ? (value?.dayOfMonth ?? 1) : undefined,
      endDate: endCondition === "on_date" ? value?.endDate : undefined,
      maxOccurrences: endCondition === "after" ? value?.maxOccurrences : undefined,
    });
  };

  const handleIntervalChange = (interval: number) => {
    if (!value) return;
    const clamped = Math.max(1, Math.min(99, interval));
    onChange({ ...value, interval: clamped });
  };

  const handleDayToggle = (day: DayOfWeek) => {
    if (!value) return;
    const current = value.daysOfWeek ?? [];
    const updated = current.includes(day) ? current.filter((d) => d !== day) : [...current, day];
    onChange({ ...value, daysOfWeek: updated });
  };

  const handleDayOfMonthChange = (dayOfMonth: number) => {
    if (!value) return;
    const clamped = Math.max(1, Math.min(31, dayOfMonth));
    onChange({ ...value, dayOfMonth: clamped });
  };

  const handleEndConditionChange = (condition: EndCondition) => {
    setEndCondition(condition);
    if (!value) return;

    onChange({
      ...value,
      endDate: condition === "on_date" ? (value.endDate ?? "") : undefined,
      maxOccurrences: condition === "after" ? (value.maxOccurrences ?? 10) : undefined,
    });
  };

  const handleMaxOccurrencesChange = (count: number) => {
    if (!value) return;
    const clamped = Math.max(1, Math.min(999, count));
    onChange({ ...value, maxOccurrences: clamped });
  };

  const handleEndDateChange = (date: string) => {
    if (!value) return;
    onChange({ ...value, endDate: date });
  };

  const showDetails = pattern !== "none";
  const showDayToggles = pattern === "daily" || pattern === "weekly" || pattern === "biweekly";
  const showDayOfMonth = pattern === "monthly";

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-sm font-medium text-foreground">
        <ArrowsClockwise size={16} weight="duotone" className="text-muted-foreground" />
        <span>Repeat</span>
      </div>

      <Select
        value={pattern}
        onChange={(val) => handlePatternChange(val as RecurrencePattern)}
        options={PATTERN_OPTIONS}
        className="w-full"
        size="sm"
      />

      {showDetails && (
        <div className="space-y-3 pl-1">
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">Every</span>
            <NumberInput
              min={1}
              max={99}
              value={value?.interval ?? 1}
              onChange={(e) => handleIntervalChange(Number(e.target.value))}
              className={INPUT_CLASS}
            />
            <span className="text-xs text-muted-foreground">{getIntervalUnit(pattern)}</span>
          </div>

          {showDayToggles && (
            <div className="space-y-1.5">
              <label className="block text-xs text-muted-foreground">
                {pattern === "daily" ? "Repeat on" : "On days"}
              </label>
              <div className="flex gap-1">
                {DAY_KEYS.map((day) => {
                  const isSelected = value?.daysOfWeek?.includes(day) ?? false;
                  return (
                    <button
                      key={day}
                      type="button"
                      onClick={() => handleDayToggle(day)}
                      className={cn(
                        "w-8 h-8 text-xs rounded-md border transition-all font-medium",
                        isSelected
                          ? "border-primary bg-primary/10 text-foreground"
                          : "border-border bg-muted/30 text-muted-foreground hover:bg-muted hover:text-foreground",
                      )}
                      title={DAY_OF_WEEK_LABELS[day].full}
                    >
                      {DAY_OF_WEEK_LABELS[day].short}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {showDayOfMonth && (
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">On day</span>
              <NumberInput
                min={1}
                max={31}
                value={value?.dayOfMonth ?? 1}
                onChange={(e) => handleDayOfMonthChange(Number(e.target.value))}
                className={INPUT_CLASS}
              />
              <span className="text-xs text-muted-foreground">of the month</span>
            </div>
          )}

          <div className="space-y-1.5">
            <label className="block text-xs text-muted-foreground">Ends</label>
            <div className="space-y-2">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="recurrence-end"
                  checked={endCondition === "never"}
                  onChange={() => handleEndConditionChange("never")}
                  className="accent-primary"
                />
                <span className="text-xs text-foreground">Never</span>
              </label>

              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="recurrence-end"
                  checked={endCondition === "after"}
                  onChange={() => handleEndConditionChange("after")}
                  className="accent-primary"
                />
                <span className="text-xs text-foreground">After</span>
                <NumberInput
                  min={1}
                  max={999}
                  value={value?.maxOccurrences ?? 10}
                  onChange={(e) => handleMaxOccurrencesChange(Number(e.target.value))}
                  disabled={endCondition !== "after"}
                  className={INPUT_CLASS}
                />
                <span className="text-xs text-foreground">occurrences</span>
              </label>

              <div className="flex items-center gap-2">
                <label className="flex items-center gap-2 cursor-pointer shrink-0">
                  <input
                    type="radio"
                    name="recurrence-end"
                    checked={endCondition === "on_date"}
                    onChange={() => handleEndConditionChange("on_date")}
                    className="accent-primary"
                  />
                  <span className="text-xs text-foreground">On</span>
                </label>
                <DatePicker
                  value={value?.endDate ?? ""}
                  onChange={handleEndDateChange}
                  disabled={endCondition !== "on_date"}
                  placeholder="Pick end date"
                  className={cn(
                    "max-w-[200px]",
                    endCondition !== "on_date" && "opacity-50 pointer-events-none",
                  )}
                />
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
