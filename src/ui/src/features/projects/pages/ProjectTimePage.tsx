import { useEffect, useMemo, useRef } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { CaretLeft, ClockCountdown } from "@phosphor-icons/react";
import { useAppDispatch, useAppSelector } from "@/app/hooks";
import { AppHeader } from "@/components/layout/AppHeader";
import { PaneBackLink, PaneHeader, PaneHeaderBar } from "@/components/ui/pane-header";
import { useDocumentTitle } from "@/shared/hooks/useDocumentTitle";
import { cn } from "@/shared/utils/cn";
import { roleCanView } from "@/shared/utils/contentRoles";
import { TimeReport } from "@/features/projects/components/time/TimeReport";
import {
  selectProjectById,
  selectTasksForProject,
  setCurrentProject,
} from "@/features/projects/store/projectsSlice";
import { fetchProject, fetchProjectTasks } from "@/features/projects/store/projectsThunks";
import { fetchTimePolicy } from "@/features/projects/store/timeThunks";
import { selectTimePolicy } from "@/features/projects/store/timeSlice";

/** Logged time across one project; anyone who can open the project can read its totals. */
export function ProjectTimePage() {
  const { projectId = "" } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const dispatch = useAppDispatch();
  const isZenMode = useAppSelector((state) => state.zenMode.isActive);
  const selectProject = useMemo(() => selectProjectById(projectId), [projectId]);
  const project = useAppSelector(selectProject);
  const selectTasks = useMemo(() => selectTasksForProject(projectId), [projectId]);
  const taskCount = useAppSelector(selectTasks).length;
  const policy = useAppSelector(selectTimePolicy);
  const loadedForRef = useRef<string | null>(null);

  useDocumentTitle(project ? `${project.name} time` : "Project time");

  useEffect(() => {
    if (!projectId) {
      navigate("/projects", { replace: true });
      return;
    }
    if (loadedForRef.current === projectId) return;
    loadedForRef.current = projectId;
    dispatch(setCurrentProject(projectId));
    if (!policy) void dispatch(fetchTimePolicy());
    if (project) return;
    void dispatch(fetchProject(projectId)).then((result) => {
      // A project the person cannot open rejects; the list is the only safe place to land.
      if (fetchProject.rejected.match(result)) navigate("/projects", { replace: true });
    });
  }, [dispatch, navigate, policy, project, projectId]);

  // Estimates come from the task rows, fetched once the project itself is known to be readable.
  const tasksForRef = useRef<string | null>(null);
  useEffect(() => {
    if (!project || tasksForRef.current === project.id) return;
    tasksForRef.current = project.id;
    if (!roleCanView(project.userRole ?? null)) {
      navigate("/projects", { replace: true });
      return;
    }
    if (taskCount === 0) void dispatch(fetchProjectTasks(project.id));
  }, [dispatch, navigate, project, taskCount]);

  return (
    <>
      <AppHeader />
      <div
        className={cn(
          "flex flex-col overflow-hidden transition-[height] duration-300",
          isZenMode ? "h-dvh" : "h-[calc(100dvh-3rem)]",
        )}
      >
        {project ? (
          <TimeReport
            projectId={project.id}
            headerBar={
              <PaneHeaderBar
                divided
                icon={<ClockCountdown size={16} />}
                title="Time"
                subtitle={`Logged on ${project.name}`}
                eyebrow={
                  <PaneBackLink onClick={() => navigate(`/projects/${projectId}`)}>
                    <CaretLeft size={12} />
                    {project.name}
                  </PaneBackLink>
                }
              />
            }
          />
        ) : (
          <PaneHeader>
            <PaneHeaderBar icon={<ClockCountdown size={16} />} title="Time" subtitle="Loading..." />
            <div className="animate-pulse space-y-4 p-4" data-testid="report-loading">
              <div className="h-8 w-64 rounded bg-muted" />
              <div className="h-60 rounded-lg bg-muted" />
            </div>
          </PaneHeader>
        )}
      </div>
    </>
  );
}
