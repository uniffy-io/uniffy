import { formatDate, formatTimeRange } from "@/features/calendar/utils/dateUtils";
import type { MeetingSuggestion } from "@/features/calendar/types/scheduling";

interface SuggestionListProps {
  suggestions: MeetingSuggestion[];
  loading: boolean;
  names: Record<string, string>;
  onPick: (startIso: string, endIso: string) => void;
  disabled?: boolean;
}

export function SuggestionList({
  suggestions,
  loading,
  names,
  onPick,
  disabled,
}: SuggestionListProps) {
  if (loading) {
    return <div className="h-8 rounded bg-muted animate-pulse" />;
  }
  if (suggestions.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No open slot inside everyone&apos;s working hours in the next week. Try fewer required
        people or a shorter meeting.
      </p>
    );
  }
  return (
    <ul className="space-y-1.5">
      {suggestions.map((suggestion) => {
        const unavailable = suggestion.unavailableOptionalUserIds;
        return (
          <li
            key={suggestion.start}
            className="flex items-center gap-3 rounded-md border border-border px-3 py-2"
          >
            <div className="min-w-0 flex-1">
              <span className="text-sm font-medium text-foreground">
                {formatDate(suggestion.start, "EEE, MMM d")}
                {" · "}
                {formatTimeRange(suggestion.start, suggestion.end)}
              </span>
              {unavailable.length > 0 && (
                <p className="truncate text-xs text-muted-foreground">
                  Without {unavailable.map((id) => names[id] ?? "1 person").join(", ")}
                </p>
              )}
            </div>
            <button
              type="button"
              disabled={disabled}
              onClick={() => onPick(suggestion.start, suggestion.end)}
              className="shrink-0 rounded-md border border-primary px-2.5 py-1 text-xs font-medium text-primary transition-colors hover:bg-primary/10 disabled:opacity-50"
            >
              Use this time
            </button>
          </li>
        );
      })}
    </ul>
  );
}
