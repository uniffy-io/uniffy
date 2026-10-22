import { ArrowSquareOut, CalendarBlank, Check, CheckSquare } from "@phosphor-icons/react";
import type { MentionDisplayMode } from "@/components/mention/mentionStateContext";
import { cn } from "@/shared/utils/cn";

const OPTIONS: { id: MentionDisplayMode; label: string; description: string }[] = [
  { id: "expanded", label: "Expanded", description: "Rich card with live metadata" },
  { id: "compact", label: "Compact", description: "Inline chip with label only" },
];

interface MentionDisplayPickerProps {
  value: MentionDisplayMode;
  onChange: (mode: MentionDisplayMode) => void;
  disabled?: boolean;
}

/** The two ways a mention renders, each shown with a sample; shared by settings and onboarding. */
export function MentionDisplayPicker({ value, onChange, disabled }: MentionDisplayPickerProps) {
  return (
    <div
      role="radiogroup"
      aria-label="Mention display"
      className="grid grid-cols-1 md:grid-cols-2 gap-2 md:gap-4"
    >
      {OPTIONS.map(({ id, label, description }) => (
        <button
          key={id}
          type="button"
          role="radio"
          aria-checked={value === id}
          disabled={disabled}
          className={cn(
            "focus-ring flex flex-col items-stretch gap-3 p-4 rounded-xl transition-shadow duration-150 text-left",
            value === id
              ? "bg-primary/5 shadow-edge-primary"
              : "bg-surface shadow-edge hover:shadow-edge-strong",
          )}
          onClick={() => onChange(id)}
        >
          <div className="flex items-center justify-between gap-2">
            <div>
              <div className="text-sm font-medium text-foreground">{label}</div>
              <div className="text-xs font-medium text-muted-foreground">{description}</div>
            </div>
            {value === id && <Check size={18} weight="bold" className="text-primary shrink-0" />}
          </div>

          <div className="rounded-md border border-border/50 bg-muted/40 p-3">
            {id === "expanded" ? <MentionPreviewExpanded /> : <MentionPreviewCompact />}
          </div>
        </button>
      ))}
    </div>
  );
}

function MentionPreviewExpanded() {
  return (
    <div className="inline-flex flex-col gap-1.5 max-w-full rounded-md border border-rose-500/40 bg-gradient-to-r from-rose-500/10 to-rose-500/5 px-3 py-2">
      <div className="flex items-center gap-2">
        <span className="flex items-center justify-center w-6 h-6 rounded-md bg-rose-500 text-white shrink-0">
          <CalendarBlank size={14} weight="duotone" />
        </span>
        <div className="min-w-0">
          <div className="text-sm font-semibold text-foreground truncate">Q2 Planning Sync</div>
          <div className="text-[11px] text-muted-foreground">
            Calendar event . Tomorrow, 10:00 AM
          </div>
        </div>
      </div>
      <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <CheckSquare size={12} weight="duotone" className="text-emerald-500" />
        <span>3 of 5 tasks ready</span>
        <span className="text-subtle-foreground">.</span>
        <ArrowSquareOut size={11} className="text-muted-foreground/70" />
        <span className="text-muted-foreground/70">Open</span>
      </div>
    </div>
  );
}

function MentionPreviewCompact() {
  return (
    <span className="inline-flex items-center gap-1 rounded-md border border-rose-500/40 bg-gradient-to-r from-rose-500/10 to-rose-500/5 px-1.5 py-0.5">
      <span className="flex items-center justify-center w-3.5 h-3.5 rounded-sm bg-rose-500 shrink-0">
        <CalendarBlank size={9} weight="duotone" className="text-white" />
      </span>
      <span className="text-xs font-medium text-foreground">Q2 Planning Sync</span>
    </span>
  );
}
