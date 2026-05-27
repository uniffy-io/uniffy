import { cn } from '@/shared/utils/cn';

const REMINDER_OPTIONS = [
  { value: 15, label: '15 min before' },
  { value: 30, label: '30 min before' },
  { value: 60, label: '1 hour before' },
  { value: 1440, label: '1 day before' },
] as const;

interface ReminderSelectorProps {
  value: number[];
  onChange: (reminders: number[]) => void;
}

export function ReminderSelector({ value, onChange }: ReminderSelectorProps) {
  const handleToggle = (minutes: number) => {
    if (value.includes(minutes)) {
      onChange(value.filter((v) => v !== minutes));
    } else {
      onChange([...value, minutes].sort((a, b) => a - b));
    }
  };

  return (
    <div className="flex flex-wrap gap-2">
      {REMINDER_OPTIONS.map((option) => {
        const isSelected = value.includes(option.value);
        return (
          <button
            key={option.value}
            type="button"
            onClick={() => handleToggle(option.value)}
            className={cn(
              'px-3 py-1.5 text-sm rounded-lg border transition-all',
              isSelected
                ? 'border-primary bg-primary/10 text-foreground'
                : 'border-border bg-muted/30 text-muted-foreground hover:bg-muted hover:text-foreground'
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
