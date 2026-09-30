import type { ComponentProps } from "react";
import { CaretDown, TextT } from "@phosphor-icons/react";
import { ToolbarButton } from "@/components/editor/toolbar/ToolbarButton";
import { ToolbarPopover } from "@/components/editor/toolbar/ToolbarPopover";
import { toolbarCommands } from "@/components/editor/toolbar/toolbarCommands";
import { useActiveMarks } from "@/components/editor/toolbar/useActiveMarks";
import { useEditorHandle } from "@/components/editor/EditorHandle";
import { cn } from "@/shared/utils/cn";

const OPTIONS: Array<{ label: string; level: number | null; size: string }> = [
  { label: "Normal text", level: null, size: "text-sm" },
  { label: "Heading 1", level: 1, size: "text-xl font-semibold" },
  { label: "Heading 2", level: 2, size: "text-lg font-semibold" },
  { label: "Heading 3", level: 3, size: "text-base font-semibold" },
];

type ToolbarTriggerProps = Parameters<ComponentProps<typeof ToolbarPopover>["trigger"]>[0];

function headingTrigger({ label, disabled }: { label: string; disabled: boolean }) {
  return ({ open, onClick, ref }: ToolbarTriggerProps) => (
    <ToolbarButton ref={ref} onClick={onClick} active={open} disabled={disabled} className="px-2">
      <TextT size={14} weight="bold" />
      <span className="text-xs">{label}</span>
      <CaretDown size={10} weight="bold" />
    </ToolbarButton>
  );
}

export function HeadingDropdown() {
  const handle = useEditorHandle();
  const { headingLevel } = useActiveMarks();
  const current = OPTIONS.find((o) => o.level === headingLevel) ?? OPTIONS[0];

  return (
    <ToolbarPopover trigger={headingTrigger({ label: current.label, disabled: !handle })}>
      {(close) => (
        <div className="flex flex-col">
          {OPTIONS.map((option) => (
            <button
              key={option.label}
              type="button"
              onClick={() => {
                if (!handle) return;
                if (option.level === null) toolbarCommands.setParagraph(handle);
                else toolbarCommands.setHeading(handle, option.level);
                close();
              }}
              className={cn(
                "flex items-center justify-between gap-3 px-3 py-1.5 rounded text-left hover:bg-muted",
                option.level === headingLevel && "bg-muted",
              )}
            >
              <span className={option.size}>{option.label}</span>
            </button>
          ))}
        </div>
      )}
    </ToolbarPopover>
  );
}
