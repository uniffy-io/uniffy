import { Check } from "@phosphor-icons/react";
import { TASK_OPEN_VIEWS, type TaskOpenView } from "@/features/projects/utils/taskPath";
import { cn } from "@/shared/utils/cn";

const DESCRIPTIONS: Record<TaskOpenView, string> = {
  panel: "Keep project list beside task",
  modal: "Open task over project",
  page: "Give task full workspace",
};

interface TaskViewPickerProps {
  value: TaskOpenView;
  onChange: (view: TaskOpenView) => void;
  disabled?: boolean;
}

export function TaskViewPicker({ value, onChange, disabled }: TaskViewPickerProps) {
  return (
    <div
      role="radiogroup"
      aria-label="Open tasks in"
      className="grid grid-cols-1 md:grid-cols-3 gap-2 md:gap-4"
    >
      {TASK_OPEN_VIEWS.map(({ value: view, label }) => (
        <button
          key={view}
          type="button"
          role="radio"
          aria-checked={value === view}
          disabled={disabled}
          className={cn(
            "focus-ring flex min-w-0 flex-col items-stretch gap-3 p-4 rounded-xl transition-shadow duration-150 text-left disabled:cursor-not-allowed",
            value === view
              ? "bg-primary/5 shadow-edge-primary"
              : "bg-surface shadow-edge hover:shadow-edge-strong",
          )}
          onClick={() => onChange(view)}
        >
          <div className="flex items-start justify-between gap-2">
            <div>
              <div className="text-sm font-medium text-foreground">{label}</div>
              <div className="text-xs font-medium text-muted-foreground">{DESCRIPTIONS[view]}</div>
            </div>
            {value === view && <Check size={18} weight="bold" className="text-primary shrink-0" />}
          </div>
          <div
            className="mt-auto rounded-md border border-border/50 bg-muted/40 p-3"
            aria-hidden="true"
          >
            <TaskViewPreview view={view} />
          </div>
        </button>
      ))}
    </div>
  );
}

function TaskViewPreview({ view }: { view: TaskOpenView }) {
  return (
    <div className="relative h-36 overflow-hidden rounded bg-background shadow-edge">
      <div className="flex h-5 items-center gap-1 border-b border-border-strong bg-nav px-2">
        <span className="size-1.5 rounded-sm bg-primary" />
        <span className="h-1 w-8 rounded bg-muted-foreground/30" />
      </div>
      <div className="absolute inset-x-0 bottom-0 top-5">
        {view !== "page" && (
          <div className="flex h-full">
            <div className="w-6 shrink-0 space-y-2 border-r border-border-strong bg-nav p-2">
              {[0, 1, 2].map((row) => (
                <div key={row} className="size-2 rounded-sm bg-muted-foreground/25" />
              ))}
            </div>
            <div className="flex-1 space-y-2 p-2">
              <div className="mb-3 h-1.5 w-12 rounded bg-muted-foreground/40" />
              {[0, 1, 2, 3].map((row) => (
                <div
                  key={row}
                  className={cn(
                    "flex h-3 items-center gap-1.5 rounded px-1",
                    row === 1 && "bg-primary/10",
                  )}
                >
                  <span
                    className={cn(
                      "size-1.5 rounded-sm",
                      row === 1 ? "bg-primary" : "bg-muted-foreground/30",
                    )}
                  />
                  <span className="h-1 w-10 rounded bg-muted-foreground/25" />
                </div>
              ))}
            </div>
          </div>
        )}
        {view === "modal" && <div className="absolute inset-0 bg-background/60" />}
        <div
          className={cn(
            "absolute bg-surface p-2",
            view === "panel" && "inset-y-0 right-0 w-[58%] border-l border-border-strong",
            view === "modal" && "inset-x-3 inset-y-2 rounded shadow-float",
            view === "page" && "inset-0 px-4 py-3",
          )}
        >
          <div className="text-[8px] font-mono text-muted-foreground">TASK-24</div>
          <div className="mt-1 truncate text-[10px] font-medium text-foreground">
            Launch checklist
          </div>
          <div className="mt-2 flex gap-1">
            <div className="h-2 w-6 rounded bg-primary/25" />
            <div className="h-2 w-4 rounded bg-muted-foreground/20" />
          </div>
          <div className="mt-3 space-y-1.5">
            <div className="h-1 w-full rounded bg-muted-foreground/25" />
            <div className="h-1 w-4/5 rounded bg-muted-foreground/25" />
            <div className="h-1 w-3/5 rounded bg-muted-foreground/25" />
          </div>
        </div>
      </div>
    </div>
  );
}
