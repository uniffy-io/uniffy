import { useState, type ComponentProps } from "react";
import { CaretDown, Table } from "@phosphor-icons/react";
import { ToolbarButton } from "@/features/notes/components/editor/toolbar/ToolbarButton";
import { ToolbarPopover } from "@/features/notes/components/editor/toolbar/ToolbarPopover";
import { toolbarCommands } from "@/features/notes/components/editor/toolbar/toolbarCommands";
import { useEditorHandle } from "@/components/editor/EditorHandle";
import { cn } from "@/shared/utils/cn";

const MAX_ROWS = 6;
const MAX_COLS = 8;

type ToolbarTriggerProps = Parameters<ComponentProps<typeof ToolbarPopover>["trigger"]>[0];

function tableTrigger({ disabled }: { disabled: boolean }) {
  return ({ open, onClick, ref }: ToolbarTriggerProps) => (
    <ToolbarButton
      ref={ref}
      onClick={onClick}
      active={open}
      disabled={disabled}
      label="Insert table"
    >
      <Table size={14} weight="bold" />
      <CaretDown size={10} weight="bold" />
    </ToolbarButton>
  );
}

export function TablePopover() {
  const handle = useEditorHandle();
  const [hover, setHover] = useState<{ rows: number; cols: number }>({ rows: 0, cols: 0 });

  return (
    <ToolbarPopover trigger={tableTrigger({ disabled: !handle })}>
      {(close) => (
        <div className="p-2">
          <div className="text-[11px] text-muted-foreground mb-1.5">
            {hover.rows && hover.cols ? `${hover.rows} x ${hover.cols}` : "Pick size"}
          </div>
          <div
            className="grid gap-0.5"
            style={{ gridTemplateColumns: `repeat(${MAX_COLS}, 14px)` }}
            onMouseLeave={() => setHover({ rows: 0, cols: 0 })}
          >
            {Array.from({ length: MAX_ROWS * MAX_COLS }, (_, i) => {
              const r = Math.floor(i / MAX_COLS) + 1;
              const c = (i % MAX_COLS) + 1;
              const filled = hover.rows >= r && hover.cols >= c;
              return (
                <button
                  key={i}
                  type="button"
                  onMouseEnter={() => setHover({ rows: r, cols: c })}
                  onClick={() => {
                    if (!handle) return;
                    toolbarCommands.insertTable(handle, r, c);
                    close();
                  }}
                  className={cn(
                    "w-3.5 h-3.5 rounded-[2px] border border-border transition-colors",
                    filled ? "bg-primary/70" : "bg-muted/40 hover:bg-muted",
                  )}
                />
              );
            })}
          </div>
        </div>
      )}
    </ToolbarPopover>
  );
}
