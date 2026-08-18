import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { Plus, Gear, CaretDoubleLeft, ChartPieSlice } from "@phosphor-icons/react";
import { useAppSelector, useAppDispatch } from "@/app/hooks";
import { cn } from "@/shared/utils/cn";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  selectProjects,
  selectCurrentProjectId,
  setCurrentProject,
  selectProjectCompletion,
} from "@/features/projects/store/projectsSlice";
import {
  openCreateProjectModal,
  selectProjectScope,
  toggleSidebar,
} from "@/features/projects/store/projectsUiSlice";
import { ProjectIcon } from "@/features/projects/utils/projectIcons";
import { ProjectScopeFilter } from "@/features/projects/components/sidebar/ProjectScopeFilter";
import { Progress } from "@/components/ui/progress";
import { ProjectsListSkeleton } from "@/features/projects/components/layout/ProjectsListSkeleton";
import { useBreakpoint } from "@/shared/hooks/useBreakpoint";
import { bucketForContent } from "@/shared/utils/contentRoles";
import { roleCanManage } from "@/shared/utils/contentRoles";
import { TagChip } from "@/features/tags";
import { useTagsByIds } from "@/features/tags/store/selectors";
import type { Project } from "@/features/projects/types";

export function ProjectsSidebar() {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const { isMobile } = useBreakpoint();
  const projects = useAppSelector(selectProjects);
  const projectsLoading = useAppSelector((state) => state.projects.loading.projects);
  const currentProjectId = useAppSelector(selectCurrentProjectId);
  const projectCompletion = useAppSelector(selectProjectCompletion);
  const projectScope = useAppSelector(selectProjectScope);
  const currentUserId = useAppSelector((s) => s.auth.user?.id ?? "");

  const filteredProjects = useMemo(() => {
    if (projectScope === "all") return projects;
    return projects.filter(
      (p) =>
        bucketForContent({
          ownerId: p.ownerId,
          accessMode: p.accessMode,
          currentUserId,
        }) === projectScope,
    );
  }, [projects, projectScope, currentUserId]);

  const handleProjectClick = (project: Project) => {
    dispatch(setCurrentProject(project.id));
    navigate(`/projects/${project.id}`);
    // Close drawer on mobile after selection
    if (isMobile) {
      dispatch(toggleSidebar());
    }
  };

  const handleCreateProject = () => {
    dispatch(openCreateProjectModal());
  };

  const handleEditProject = (project: Project) => {
    navigate(`/projects/${project.id}/settings`);
  };

  return (
    <>
      <div className="flex flex-col h-full">
        {/* Header: scope filter + create button */}
        <div className="flex items-center px-3 pt-3 pb-2 gap-0.5">
          <ProjectScopeFilter />

          <button
            type="button"
            onClick={handleCreateProject}
            className="group relative flex items-center py-1.5 px-1.5 text-sm font-medium rounded-lg transition-all duration-700 ease-out overflow-hidden hover:px-2.5"
          >
            <span className="absolute inset-0 rounded-lg bg-transparent" />
            <span className="relative z-10 flex items-center justify-center w-7 h-7 rounded-md text-muted-foreground group-hover:text-primary transition-all duration-500 ease-out">
              <Plus size={18} weight="bold" />
            </span>
            <span className="relative z-10 ml-0 max-w-0 overflow-hidden whitespace-nowrap transition-all duration-700 ease-out group-hover:ml-1.5 group-hover:max-w-24 text-muted-foreground group-hover:text-foreground">
              New
            </span>
          </button>
          <div className="flex-1" />
          {!isMobile && (
            <button
              onClick={() => dispatch(toggleSidebar())}
              className="p-1.5 rounded-md bg-transparent hover:bg-muted transition-colors shrink-0"
              title="Toggle sidebar"
            >
              <CaretDoubleLeft size={16} weight="bold" className="text-primary" />
            </button>
          )}
        </div>

        {/* Project List */}
        <ScrollArea className="flex-1">
          <div className="px-2 pt-1 pb-2 space-y-0.5">
            {projectsLoading && projects.length === 0 ? (
              <ProjectsListSkeleton />
            ) : filteredProjects.length === 0 ? (
              <div className="px-2 py-8 text-center text-xs text-muted-foreground">
                {projects.length === 0 ? (
                  <>
                    <p>No projects yet</p>
                    <button
                      type="button"
                      className="mt-2 text-primary hover:underline text-xs"
                      onClick={handleCreateProject}
                    >
                      Create your first project
                    </button>
                  </>
                ) : (
                  <p>No projects match this filter</p>
                )}
              </div>
            ) : (
              filteredProjects.map((project) => {
                const canAccessSettings = roleCanManage(project.userRole);
                return (
                  <ProjectListItem
                    key={project.id}
                    project={project}
                    isActive={project.id === currentProjectId}
                    onClick={() => handleProjectClick(project)}
                    onEdit={canAccessSettings ? () => handleEditProject(project) : undefined}
                    progress={projectCompletion[project.id] ?? 0}
                  />
                );
              })
            )}
          </div>
        </ScrollArea>

        {/* Portfolio link */}
        <div className="px-3 py-2 border-t border-border">
          <button
            type="button"
            onClick={() => navigate("/portfolio")}
            className="flex items-center gap-2 w-full px-2 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-accent rounded-md transition-colors"
          >
            <ChartPieSlice size={14} />
            Portfolio Overview
          </button>
        </div>
      </div>
    </>
  );
}

interface ProjectListItemProps {
  project: Project;
  isActive: boolean;
  onClick: () => void;
  onEdit?: () => void;
  progress: number;
}

function ProjectListItem({ project, isActive, onClick, onEdit, progress }: ProjectListItemProps) {
  const tags = useTagsByIds(project.tagIds ?? []);
  const shownTags = tags.slice(0, 2);
  const tagOverflow = tags.length - shownTags.length;
  return (
    <div
      className={cn(
        "group w-full flex flex-col gap-1 px-2 py-1.5 rounded-md text-left text-sm cursor-pointer",
        "hover:bg-accent transition-colors",
        isActive && "bg-primary/10 text-primary",
      )}
      onClick={onClick}
    >
      <div className="flex items-center gap-3">
        <ProjectIcon
          icon={project.icon}
          size={16}
          weight={isActive ? "fill" : "duotone"}
          className={cn("shrink-0", isActive ? "text-primary" : "text-muted-foreground")}
        />
        <span className="flex-1 truncate">{project.name}</span>
        {onEdit && (
          <span
            role="button"
            tabIndex={0}
            onClick={(e) => {
              e.stopPropagation();
              onEdit();
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.stopPropagation();
                onEdit();
              }
            }}
            className="p-0.5 rounded hover:bg-muted opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
            title="Settings"
          >
            <Gear size={14} weight="duotone" className="text-muted-foreground" />
          </span>
        )}
      </div>

      {/* Tags row (read-only) */}
      {shownTags.length > 0 && (
        <div className="pl-7 pr-2 flex flex-wrap items-center gap-1">
          {shownTags.map((tag) => (
            <TagChip key={tag.id} tag={tag} nonInteractive className="px-1.5 py-0 text-[10px]" />
          ))}
          {tagOverflow > 0 && (
            <span
              className="text-[10px] text-muted-foreground"
              title={tags
                .slice(2)
                .map((t) => t.name)
                .join(", ")}
            >
              +{tagOverflow}
            </span>
          )}
        </div>
      )}

      {/* Progress bar */}
      <div className="pl-7 pr-2 opacity-50 text-[10px] flex items-center gap-2">
        <Progress value={progress} className="h-1" />
        <span className="w-6 text-right">{progress}%</span>
      </div>
    </div>
  );
}
