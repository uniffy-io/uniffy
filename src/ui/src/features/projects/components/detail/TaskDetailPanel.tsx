import { CaretRight, SidebarSimple, X } from "@phosphor-icons/react";
import { useAppDispatch } from "@/app/hooks";
import { PageLoader } from "@/components/feedback/PageLoader";
import { TaskTypeIcon } from "@/features/projects/components/TaskTypeIcon";
import { WatchButton } from "@/features/projects/components/detail/fields/WatchButton";
import { TaskDetailLayout } from "@/features/projects/components/detail/TaskDetailLayout";
import {
  TaskLoadError,
  TaskUnavailable,
} from "@/features/projects/components/detail/TaskUnavailable";
import { TimerButton } from "@/features/projects/components/time/TimerButton";
import type { TaskDetail } from "@/features/projects/hooks/useTaskDetail";
import { useOpenTask } from "@/features/projects/hooks/useOpenTask";
import { closeDetailPanel, selectTask } from "@/features/projects/store/projectsUiSlice";
import type { TaskOpenView } from "@/features/projects/utils/taskPath";
import { TaskViewMenu } from "@/features/projects/components/detail/TaskViewMenu";
import { useBreakpoint } from "@/shared/hooks/useBreakpoint";
import { useOverlayEscape } from "@/shared/hooks/useOverlayEscape";

interface TaskDetailPanelProps {
  taskId: string;
  detail: TaskDetail;
  variant?: "sidebar" | "modal";
  view?: TaskOpenView;
  onClose?: () => void;
}

export function TaskDetailPanel({
  taskId,
  detail,
  variant = "sidebar",
  view = "panel",
  onClose,
}: TaskDetailPanelProps) {
  const dispatch = useAppDispatch();
  const openTask = useOpenTask();
  const { isMobileOrTablet } = useBreakpoint();
  const {
    task,
    project,
    allProjectTasks,
    blocksTaskIds,
    subtaskTimeSpent,
    canEdit,
    sprints,
    onDescriptionDone,
    ancestors: ancestorChain,
    loadFailed,
    loadError,
    retry,
  } = detail;

  const handleClose = () => {
    if (onClose) {
      onClose();
      return;
    }
    dispatch(closeDetailPanel());
    dispatch(selectTask(null));
  };

  useOverlayEscape(() => {
    // Escape inside a field cancels the field edit, not the whole panel.
    const tag = document.activeElement?.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA") return;
    handleClose();
  });

  if (loadFailed || !task) {
    return (
      <div className="relative h-full">
        {isMobileOrTablet && (
          <button
            onClick={handleClose}
            className="absolute right-3 top-3 p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            aria-label="Close panel"
          >
            <X size={16} weight="bold" />
          </button>
        )}
        {loadFailed ? (
          <TaskUnavailable taskId={taskId} />
        ) : loadError ? (
          <TaskLoadError onRetry={retry} />
        ) : (
          <PageLoader />
        )}
      </div>
    );
  }

  const ticketId = project ? `${project.slug}-${task.number}` : `#${task.number}`;

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-3 md:px-4 py-1 border-b border-border">
        <div className="flex items-center gap-2">
          {isMobileOrTablet && (
            <button
              onClick={handleClose}
              className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              aria-label="Close panel"
            >
              <X size={16} weight="bold" />
            </button>
          )}
          <TaskTypeIcon type={task.taskType} className="text-muted-foreground" />
          <span
            className="text-sm font-mono text-muted-foreground hover:text-foreground cursor-pointer"
            onClick={() => navigator.clipboard.writeText(ticketId)}
            title="Click to copy"
          >
            {ticketId}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <TaskViewMenu taskId={task.id} projectId={task.projectId} view={view} />
          <TimerButton task={task} />
          <WatchButton taskId={task.id} />
          {!isMobileOrTablet && (
            <button
              onClick={handleClose}
              className="px-2 py-1 rounded-md text-primary bg-primary/10 transition-colors"
              aria-label="Close panel"
            >
              <SidebarSimple size={16} className="transform -scale-x-100" />
            </button>
          )}
        </div>
      </div>

      {ancestorChain.length > 0 && (
        <div className="flex items-center gap-1 text-xs text-muted-foreground px-4 pt-2 flex-wrap">
          {ancestorChain.map((ancestor, i) => (
            <span key={ancestor.id} className="flex items-center gap-1">
              {i > 0 && <CaretRight size={10} className="text-subtle-foreground" />}
              <button
                type="button"
                className="font-mono hover:text-foreground hover:underline transition-colors truncate max-w-[150px]"
                onClick={() => openTask(ancestor.id)}
                title={ancestor.title}
              >
                {project?.slug}-{ancestor.number}
              </button>
            </span>
          ))}
          <CaretRight size={10} className="text-subtle-foreground" />
          <span className="font-mono text-foreground font-medium">{ticketId}</span>
        </div>
      )}

      <div className="flex-1 min-h-0">
        <TaskDetailLayout
          task={task}
          project={project}
          allProjectTasks={allProjectTasks}
          sprints={sprints}
          blocksTaskIds={blocksTaskIds}
          subtaskTimeSpent={subtaskTimeSpent}
          canEdit={canEdit}
          mode={variant}
          onDescriptionDone={onDescriptionDone}
        />
      </div>
    </div>
  );
}
