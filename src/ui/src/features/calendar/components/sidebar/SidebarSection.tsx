import { CaretDown, Plus } from "@phosphor-icons/react";
import { useAppDispatch, useAppSelector } from "@/app/hooks";
import { toggleSectionCollapse } from "@/features/calendar/store";
import type { SidebarSectionId } from "@/features/calendar/types";
import { cn } from "@/shared/utils/cn";
import type { ReactNode, Ref } from "react";

interface SidebarSectionProps {
  id: SidebarSectionId;
  title: string;
  children: ReactNode;
  action?: ReactNode;
}

export function SidebarSection({ id, title, children, action }: SidebarSectionProps) {
  const dispatch = useAppDispatch();
  const collapsedSections = useAppSelector((state) => state.calendarUi.collapsedSections);

  const isCollapsed = collapsedSections.includes(id);

  const handleToggle = () => {
    dispatch(toggleSectionCollapse(id));
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <button
          onClick={handleToggle}
          aria-expanded={!isCollapsed}
          className="focus-ring min-h-11 flex flex-1 items-center gap-1 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider hover:text-foreground transition-colors"
        >
          <span>{title}</span>
          <CaretDown
            size={12}
            weight="bold"
            className={cn("transition-transform", isCollapsed && "-rotate-90")}
          />
        </button>
        {action}
      </div>

      {!isCollapsed && <div className="space-y-1">{children}</div>}
    </div>
  );
}

interface SidebarSectionAddProps {
  label: string;
  onClick: () => void;
  /** Set when the control opens a menu rather than a dialog. */
  menu?: { ref: Ref<HTMLButtonElement>; open: boolean };
}

/** The section header's add control; every section uses it so the icons line up. */
export function SidebarSectionAdd({ label, onClick, menu }: SidebarSectionAddProps) {
  return (
    <button
      ref={menu?.ref}
      type="button"
      aria-haspopup={menu ? "menu" : undefined}
      aria-expanded={menu ? menu.open : undefined}
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
      className="focus-ring min-w-11 min-h-11 flex items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
      title={label}
      aria-label={label}
    >
      <Plus size={14} weight="bold" />
    </button>
  );
}
