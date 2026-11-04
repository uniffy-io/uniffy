import { useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  Check,
  Copy,
  FrameCorners,
  SidebarSimple,
  ArrowsOutSimple,
  PushPin,
} from "@phosphor-icons/react";
import { toast } from "sonner";
import { useAppSelector } from "@/app/hooks";
import { ActionMenu, ActionMenuItem, ActionMenuSeparator } from "@/components/ui/action-menu";
import { friendlyErrorMessage } from "@/config/errorMessages";
import { selectTaskNavigationOrder } from "@/features/projects/store/projectsUiSlice";
import { readTaskPageState } from "@/features/projects/utils/taskNavigation";
import {
  TASK_OPEN_VIEWS,
  taskLinkPath,
  taskProjectPath,
  type TaskOpenView,
} from "@/features/projects/utils/taskPath";
import { useTaskViewPreference } from "@/features/settings/hooks/useTaskViewPreference";

const VIEW_ICONS = { panel: SidebarSimple, modal: FrameCorners, page: ArrowsOutSimple };

export function TaskViewMenu({
  taskId,
  projectId,
  view,
}: {
  taskId: string;
  projectId: string;
  view: TaskOpenView;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const navigate = useNavigate();
  const location = useLocation();
  const navigationOrder = useAppSelector(selectTaskNavigationOrder);
  const preference = useTaskViewPreference();
  const Icon = VIEW_ICONS[view];

  const switchView = (next: TaskOpenView) => {
    setOpen(false);
    const previous = readTaskPageState(location.state);
    const isTaskRoute = location.pathname.startsWith("/projects/task/");
    const params = new URLSearchParams(location.search);
    const projectView = params.get(isTaskRoute ? "projectView" : "view");
    navigate(taskLinkPath(taskId, next, projectView), {
      replace: isTaskRoute,
      state: {
        order: previous.order ?? (navigationOrder.includes(taskId) ? navigationOrder : undefined),
        from:
          previous.from ??
          (isTaskRoute
            ? taskProjectPath(projectId, projectView)
            : `${location.pathname}${location.search}`),
      },
    });
  };

  const copyLink = async () => {
    setOpen(false);
    try {
      await navigator.clipboard.writeText(`${window.location.origin}${taskLinkPath(taskId)}`);
      toast.success("Task link copied");
    } catch (error) {
      const message = friendlyErrorMessage(error instanceof Error ? error.message : String(error));
      if (message) toast.error(message);
    }
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="focus-ring flex size-11 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground lg:size-8"
        aria-label="Task view"
        title="Task view"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        data-testid="task-view-menu"
      >
        <Icon size={16} />
      </button>
      <ActionMenu
        open={open}
        onClose={() => setOpen(false)}
        triggerRef={triggerRef}
        label="Task view"
        align="right"
      >
        {TASK_OPEN_VIEWS.map((option) => {
          const ViewIcon = VIEW_ICONS[option.value];
          return (
            <ActionMenuItem
              key={option.value}
              role="menuitemradio"
              aria-checked={view === option.value}
              onClick={() => switchView(option.value)}
            >
              <ViewIcon size={16} />
              <span className="flex-1">{option.label}</span>
              {view === option.value && <Check size={14} />}
            </ActionMenuItem>
          );
        })}
        <ActionMenuSeparator />
        <ActionMenuItem
          disabled={preference.disabled || preference.taskOpenView === view}
          onClick={() => {
            setOpen(false);
            void preference.save(view);
          }}
        >
          <PushPin size={16} />
          {preference.taskOpenView === view ? "Your default view" : "Make default"}
        </ActionMenuItem>
        <ActionMenuItem onClick={() => void copyLink()}>
          <Copy size={16} />
          Copy task link
        </ActionMenuItem>
      </ActionMenu>
    </>
  );
}
