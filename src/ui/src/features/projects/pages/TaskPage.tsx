import { useCallback, useEffect } from "react";
import { Navigate, useLocation, useNavigate, useParams } from "react-router-dom";
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
import { OpenTaskContext } from "@/features/projects/hooks/useOpenTask";
import { useTaskDetail } from "@/features/projects/hooks/useTaskDetail";
import { setCurrentProject } from "@/features/projects/store/projectsSlice";
import { fetchProject, fetchProjectTasks } from "@/features/projects/store/projectsThunks";
import { fetchSprints } from "@/features/projects/store/sprintsThunks";
import { neighbours, readTaskPageState } from "@/features/projects/utils/taskNavigation";
import {
  parseTaskOpenView,
  taskLinkPath,
  taskProjectPath,
  taskUrn,
} from "@/features/projects/utils/taskPath";
import { ProjectsWorkspace } from "@/features/projects/pages/ProjectsPage";
import { TaskViewMenu } from "@/features/projects/components/detail/TaskViewMenu";
import { useAppearanceSettings } from "@/features/settings/hooks/useSettings";
import { useDocumentTitle } from "@/shared/hooks/useDocumentTitle";
import { cn } from "@/shared/utils/cn";

interface TaskPageProps {
  fullPage?: boolean;
}

export function TaskPage({ fullPage = false }: TaskPageProps) {
  const { taskId = "", projectId: routedProjectId } = useParams<{
    taskId: string;
    projectId?: string;
  }>();
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const location = useLocation();
  const { taskOpenView } = useAppearanceSettings();
  const settingsInitialized = useAppSelector((state) => state.settings.initialized);
  const params = new URLSearchParams(location.search);
  const explicitView = parseTaskOpenView(params.get("view"));
  const view = fullPage ? "page" : (explicitView ?? taskOpenView);
  const projectView = routedProjectId ? params.get("view") : params.get("projectView");
  const organizationId = useAppSelector((state) => state.auth.currentOrganizationId);
  const isZenMode = useAppSelector((state) => state.zenMode.isActive);
  const detail = useTaskDetail(taskId);
  const { task, project, loadFailed } = detail;
  const projectId = task?.projectId;

  const { match: otherOrganization } = useContentOrganizationResolver(
    taskId ? taskUrn(taskId) : null,
    loadFailed,
  );

  // Hosted outside the project page, so the project, its tasks and sprints load here.
  useEffect(() => {
    if (!projectId || view !== "page") return;
    dispatch(setCurrentProject(projectId));
    void dispatch(fetchProject(projectId));
    void dispatch(fetchSprints(projectId));
    const tasksLoad = dispatch(fetchProjectTasks(projectId));
    return () => tasksLoad.abort();
  }, [dispatch, projectId, organizationId, view]);

  const { order, from } = readTaskPageState(location.state);
  const { prev, next } = neighbours(order, taskId);
  const ticketId = task ? (project ? `${project.slug}-${task.number}` : `#${task.number}`) : "";
  useDocumentTitle(task ? `${ticketId} ${task.title}` : "Task");

  const goToTask = (id: string) =>
    navigate(taskLinkPath(id, view, projectView), { state: { order, from }, replace: true });
  const openTask = useCallback(
    (id: string) => navigate(taskLinkPath(id, view, projectView), { state: { from } }),
    [navigate, from, view, projectView],
  );
  const goBack = () => {
    if (from) navigate(from);
    else if (projectId) navigate(taskProjectPath(projectId, projectView));
    else navigate("/projects");
  };

  const shellClass = cn(
    "flex flex-col bg-background transition-[height] duration-300",
    isZenMode ? "h-dvh delay-150" : "h-[calc(100dvh-3rem)] delay-0",
  );

  if (!explicitView && !fullPage && !settingsInitialized) {
    return <PageLoader />;
  }
  if (!explicitView || fullPage || routedProjectId) {
    return <Navigate to={taskLinkPath(taskId, view, projectView)} state={location.state} replace />;
  }

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
  } else if (view !== "page") {
    return (
      <OpenTaskContext.Provider value={openTask}>
        <ProjectsWorkspace taskRoute={{ projectId: task.projectId, taskId, view }} />
      </OpenTaskContext.Provider>
    );
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
          <OpenTaskContext.Provider value={openTask}>
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
          </OpenTaskContext.Provider>
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
