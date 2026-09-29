import { Select, type SelectOption } from "@/components/ui/select";
import { useCalendarLabel } from "@/features/calendar/hooks/useCalendars";
import type { CalendarInfo } from "@/features/calendar/types";

interface CalendarSelectProps {
  calendars: CalendarInfo[];
  value: string | undefined;
  onChange: (calendarId: string) => void;
  disabled?: boolean;
  size?: "sm" | "md";
  className?: string;
  triggerClassName?: string;
  ariaLabel?: string;
}

export function CalendarSelect({
  calendars,
  value,
  onChange,
  disabled,
  size,
  className,
  triggerClassName,
  ariaLabel = "Calendar",
}: CalendarSelectProps) {
  const labelOf = useCalendarLabel();
  const options: SelectOption[] = calendars.map((calendar) => ({
    value: calendar.id,
    label: labelOf(calendar),
    icon: (
      <span
        className="inline-block w-2.5 h-2.5 rounded-full shrink-0"
        style={{ backgroundColor: calendar.color }}
      />
    ),
  }));

  return (
    <Select
      value={value}
      onChange={onChange}
      options={options}
      disabled={disabled}
      size={size}
      className={className}
      triggerClassName={triggerClassName}
      ariaLabel={ariaLabel}
      searchable={options.length > 8}
      menuMinWidth={200}
      placeholder="Choose a calendar"
    />
  );
}
