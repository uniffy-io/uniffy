import { useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { ArrowLeft, CaretDown, CaretUp } from "@phosphor-icons/react";
import { useAppDispatch, useAppSelector } from "@/app/hooks";
import { PageLoader } from "@/components/feedback/PageLoader";
import { AppHeader } from "@/components/layout/AppHeader";
import {
  PaneBackLink,
  PaneHeader,
  PaneHeaderBar,
  PaneIconButton,
} from "@/components/ui/pane-header";
import { WrongOrganizationNotice } from "@/features/auth/components/WrongOrganizationNotice";
import { useContentOrganizationResolver } from "@/features/auth/hooks/useContentOrganizationResolver";
import { TaskTypeIcon } from "@/features/projects/components/TaskTypeIcon";
import { WatchButton } from "@/features/projects/components/detail/fields/WatchButton";
import { TaskDetailLayout } from "@/features/projects/components/detail/TaskDetailLayout";
import {
  TaskLoadError,
  TaskUnavailable,
} from "@/features/projects/components/detail/TaskUnavailable";
import { TimerButton } from "@/features/projects/components/time/TimerButton";
import type { TaskDetail } from "@/features/projects/hooks/useTaskDetail";
import { setCurrentProject } from "@/features/projects/store/projectsSlice";
import { fetchProject, fetchProjectTasks } from "@/features/projects/store/projectsThunks";
import { fetchSprints } from "@/features/projects/store/sprintsThunks";
import { neighbours, readTaskPageState } from "@/features/projects/utils/taskNavigation";
import {
  type TaskOpenView,
  taskLinkPath,
  taskProjectPath,
  taskUrn,
} from "@/features/projects/utils/taskPath";
import { TaskViewMenu } from "@/features/projects/components/detail/TaskViewMenu";
import { cn } from "@/shared/utils/cn";

interface TaskPageContentProps {
  taskId: string;
  detail: TaskDetail;
  view: TaskOpenView;
  projectView: string | null;
}

export function TaskPageContent({ taskId, detail, view, projectView }: TaskPageContentProps) {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const location = useLocation();
  const organizationId = useAppSelector((state) => state.auth.currentOrganizationId);
  const isZenMode = useAppSelector((state) => state.zenMode.isActive);
  const { task, project, loadFailed } = detail;
  const projectId = task?.projectId;

  const { match: otherOrganization } = useContentOrganizationResolver(
    taskId ? taskUrn(taskId) : null,
    loadFailed,
  );

  // Full-page tasks load project metadata without mounting the workspace.
  useEffect(() => {
    if (!projectId || loadFailed || view !== "page") return;
    dispatch(setCurrentProject(projectId));
    void dispatch(fetchProject(projectId));
    void dispatch(fetchSprints(projectId));
    const tasksLoad = dispatch(fetchProjectTasks(projectId));
    return () => tasksLoad.abort();
  }, [dispatch, projectId, organizationId, view, loadFailed]);

  const { order, from } = readTaskPageState(location.state);
  const { prev, next } = neighbours(order, taskId);
  const ticketId = task ? (project ? `${project.slug}-${task.number}` : `#${task.number}`) : "";

  const goToTask = (id: string) =>
    navigate(taskLinkPath(id, view, projectView), { state: { order, from }, replace: true });
  const goBack = () => {
    if (from) navigate(from);
    else if (projectId) navigate(taskProjectPath(projectId, projectView));
    else navigate("/projects");
  };

  const shellClass = cn(
    "flex flex-col bg-background transition-[height] duration-300",
    isZenMode ? "h-dvh delay-150" : "h-[calc(100dvh-3rem)] delay-0",
  );

  let body;
  if (loadFailed && otherOrganization) {
    body = (
      <WrongOrganizationNotice
        urn={taskUrn(taskId)}
        organization={otherOrganization}
        path={`${location.pathname}${location.search}`}
        onDismiss={() => navigate("/projects", { replace: true })}
        className="h-full"
      />
    );
  } else if (loadFailed) {
    body = <TaskUnavailable taskId={taskId} />;
  } else if (!task && detail.loadError) {
    body = <TaskLoadError onRetry={detail.retry} />;
  } else if (!task) {
    body = <PageLoader />;
  } else {
    body = (
      <>
        <PaneHeader>
          <PaneHeaderBar
            compact
            leading={
              <>
                <PaneBackLink
                  onClick={goBack}
                  className="max-w-48 shrink-0 truncate"
                  data-testid="task-page-back"
                >
                  <ArrowLeft size={12} />
                  {from ? "Back" : (project?.name ?? "Project")}
                </PaneBackLink>
                <span className="h-4 w-px shrink-0 bg-border" aria-hidden="true" />
              </>
            }
            icon={<TaskTypeIcon type={task.taskType} className="text-muted-foreground" />}
            title={<span className="font-mono text-sm text-muted-foreground">{ticketId}</span>}
          >
            <div className="flex items-center gap-1">
              {order && (
                <>
                  <PaneIconButton
                    aria-label="Previous task"
                    title="Previous task"
                    disabled={!prev}
                    onClick={() => prev && goToTask(prev)}
                    data-testid="task-page-prev"
                  >
                    <CaretUp size={16} />
                  </PaneIconButton>
                  <PaneIconButton
                    aria-label="Next task"
                    title="Next task"
                    disabled={!next}
                    onClick={() => next && goToTask(next)}
                    data-testid="task-page-next"
                  >
                    <CaretDown size={16} />
                  </PaneIconButton>
                </>
              )}
              <TimerButton task={task} />
              <WatchButton taskId={task.id} />
              <TaskViewMenu taskId={task.id} projectId={task.projectId} view="page" />
            </div>
          </PaneHeaderBar>
        </PaneHeader>
        <div className="min-h-0 flex-1" data-testid="task-page-body">
          <TaskDetailLayout
            task={task}
            project={project}
            allProjectTasks={detail.allProjectTasks}
            sprints={detail.sprints}
            blocksTaskIds={detail.blocksTaskIds}
            subtaskTimeSpent={detail.subtaskTimeSpent}
            canEdit={detail.canEdit}
            mode="page"
            onDescriptionDone={detail.onDescriptionDone}
          />
        </div>
      </>
    );
  }

  return (
    <>
      <AppHeader />
      <main className={shellClass} data-testid="task-page">
        {body}
      </main>
    </>
  );
}
