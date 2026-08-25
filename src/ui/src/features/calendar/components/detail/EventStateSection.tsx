import { CalendarCheck, EyeSlash, Clock, AirplaneTilt } from "@phosphor-icons/react";
import { cn } from "@/shared/utils/cn";
import { SectionLabel } from "@/features/calendar/components/detail/SectionLabel";
import type { CalendarEvent, EventStatus } from "@/features/calendar/types";
import type { EventPatch } from "@/features/calendar/hooks/useEventCommit";

interface EventStateSectionProps {
  event: CalendarEvent;
  canEdit: boolean;
  commit: (patch: EventPatch) => void;
}

const STATUS_OPTIONS: { value: EventStatus; label: string }[] = [
  { value: "confirmed", label: "Confirmed" },
  { value: "tentative", label: "Tentative" },
  { value: "cancelled", label: "Cancelled" },
];

function ToggleRow({
  icon,
  label,
  hint,
  active,
  disabled,
  onToggle,
}: {
  icon: React.ReactNode;
  label: string;
  hint: string;
  active: boolean;
  disabled: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={disabled}
      className="flex items-center gap-2 px-2 py-1.5 bg-muted/30 rounded-lg w-full hover:bg-muted/50 transition-colors disabled:pointer-events-none"
    >
      {icon}
      <span
        className={cn(
          "w-3 h-3 rounded-full border-2 transition-colors",
          active ? "border-primary bg-primary" : "border-muted-foreground",
        )}
      />
      <span className="text-xs text-foreground">{label}</span>
      <span className="text-xs text-muted-foreground ml-auto">{hint}</span>
    </button>
  );
}

export function EventStateSection({ event, canEdit, commit }: EventStateSectionProps) {
  if (!canEdit) {
    const badges: string[] = [];
    if (event.status !== "confirmed") badges.push(event.status);
    if (event.visibility === "private") badges.push("private");
    if (event.transparency === "transparent") badges.push("free");
    if (event.isOutOfOffice) badges.push("out of office");
    if (badges.length === 0) return null;
    return (
      <div className="flex flex-wrap gap-1.5">
        {badges.map((badge) => (
          <span
            key={badge}
            className="px-2 py-0.5 text-xs rounded-full bg-muted text-muted-foreground capitalize"
          >
            {badge}
          </span>
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div>
        <SectionLabel>Status</SectionLabel>
        <div className="flex flex-wrap gap-1.5">
          {STATUS_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => commit({ status: option.value })}
              className={cn(
                "px-2 py-1 text-xs rounded-lg border transition-all",
                event.status === option.value
                  ? option.value === "cancelled"
                    ? "border-red-300 bg-red-100 text-red-800 dark:border-red-800 dark:bg-red-900/30 dark:text-red-400"
                    : "border-primary bg-primary/10 text-foreground"
                  : "border-border bg-muted/30 text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              {option.value === "cancelled" ? (
                <CalendarCheck size={12} weight="duotone" className="inline mr-1.5 -mt-px" />
              ) : null}
              {option.label}
            </button>
          ))}
        </div>
        {event.status === "cancelled" && (
          <p className="mt-1.5 text-xs text-muted-foreground">
            Cancelled events stay visible to attendees and stop blocking time.
          </p>
        )}
      </div>

      <div className="space-y-1.5">
        <ToggleRow
          icon={<EyeSlash size={16} weight="duotone" className="text-muted-foreground" />}
          label="Private"
          hint="Others see only a busy block"
          active={event.visibility === "private"}
          disabled={!canEdit}
          onToggle={() =>
            commit({ visibility: event.visibility === "private" ? "standard" : "private" })
          }
        />
        <ToggleRow
          icon={<Clock size={16} weight="duotone" className="text-muted-foreground" />}
          label="Free"
          hint="Does not block time in availability"
          active={event.transparency === "transparent"}
          disabled={!canEdit}
          onToggle={() =>
            commit({
              transparency: event.transparency === "transparent" ? "opaque" : "transparent",
            })
          }
        />
        <ToggleRow
          icon={<AirplaneTilt size={16} weight="duotone" className="text-muted-foreground" />}
          label="Out of office"
          hint="Reads distinctly to colleagues"
          active={event.isOutOfOffice}
          disabled={!canEdit}
          onToggle={() => commit({ isOutOfOffice: !event.isOutOfOffice })}
        />
      </div>
    </div>
  );
}
