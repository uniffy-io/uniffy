import { useId } from "react";
import { CATEGORY_COLORS } from "@/features/calendar/constants";
import { cn } from "@/shared/utils/cn";

interface CalendarColorPickerProps {
  value: string;
  onChange: (color: string) => void;
}

export function CalendarColorPicker({ value, onChange }: CalendarColorPickerProps) {
  const labelId = useId();
  return (
    <div>
      <span id={labelId} className="block text-sm text-muted-foreground mb-1">
        Color
      </span>
      <div role="group" aria-labelledby={labelId} className="flex flex-wrap gap-2">
        {CATEGORY_COLORS.map((option) => {
          const selected = value.toLowerCase() === option.value.toLowerCase();
          return (
            <button
              key={option.value}
              type="button"
              onClick={() => onChange(option.value)}
              className={cn(
                "focus-ring w-11 h-11 rounded-full transition-transform hover:scale-105",
                selected && "outline outline-2 outline-offset-2 outline-primary",
              )}
              style={{ backgroundColor: option.value }}
              title={option.name}
              aria-label={option.name}
              aria-pressed={selected}
            />
          );
        })}
      </div>
    </div>
  );
}
