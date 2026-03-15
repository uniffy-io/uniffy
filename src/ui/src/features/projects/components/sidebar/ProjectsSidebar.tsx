/**
 * ProjectsSidebar - Left navigation sidebar for projects
 *
 * Matches the style of other feature sidebars (calendar, notes).
 * No heading - just scope filter + create button, then project list.
 */

import { useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { Plus, Trash, PencilSimple, CaretDoubleLeft } from "@phosphor-icons/react";
import { useAppSelector, useAppDispatch } from "@/app/hooks";
import { cn } from "@/shared/utils/cn";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  selectProjects,
  selectCurrentProjectId,
  setCurrentProject,
  selectProjectCompletion,
} from "@/features/projects/store/projectsSlice";
import { deleteProject } from "@/features/projects/store/projectsThunks";
import { openCreateProjectModal, openEditProjectModal, selectProjectScope, toggleSidebar } from "@/features/projects/store/projectsUiSlice";
import { ProjectIcon } from "@/features/projects/utils/projectIcons";
import { ProjectScopeFilter } from "@/features/projects/components/sidebar/ProjectScopeFilter";
import { Progress } from "@/components/ui/progress";
import { useBreakpoint } from "@/shared/hooks/useBreakpoint";
import type { Project } from "@/features/projects/types";

export function ProjectsSidebar() {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const { isMobile } = useBreakpoint();
  const projects = useAppSelector(selectProjects);
  const currentProjectId = useAppSelector(selectCurrentProjectId);
  const projectCompletion = useAppSelector(selectProjectCompletion);
  const projectScope = useAppSelector(selectProjectScope);

  // Filter projects by scope
  const filteredProjects = useMemo(() => {
    if (projectScope === "all") return projects;
    if (projectScope === "personal") {
      return projects.filter((p) => p.visibility === "PRIVATE");
    }
    return projects.filter((p) => p.visibility === "ORGANIZATION");
  }, [projects, projectScope]);

  const handleProjectClick = (project: Project) => {
    dispatch(setCurrentProject(project.id));
    navigate(`/projects/${project.id}`);
    // Close drawer on mobile after selection
    if (isMobile) {
      dispatch(toggleSidebar());
    }
  };

  const [projectToDelete, setProjectToDelete] = useState<Project | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const handleCreateProject = () => {
    dispatch(openCreateProjectModal());
  };

  const handleEditProject = (project: Project) => {
    dispatch(openEditProjectModal(project.id));
  };

  const handleDeleteProject = (project: Project) => {
    setProjectToDelete(project);
  };

  const confirmDeleteProject = async () => {
    if (!projectToDelete) return;
    setIsDeleting(true);
    try {
      await dispatch(deleteProject(projectToDelete.id)).unwrap();
    } finally {
      setIsDeleting(false);
      setProjectToDelete(null);
    }
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
          {filteredProjects.length === 0 ? (
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
            filteredProjects.map((project) => (
              <ProjectListItem
                key={project.id}
                project={project}
                isActive={project.id === currentProjectId}
                onClick={() => handleProjectClick(project)}
                onEdit={() => handleEditProject(project)}
                onDelete={() => handleDeleteProject(project)}
                progress={projectCompletion[project.id] ?? 0}
              />
            ))
          )}
        </div>
      </ScrollArea>
    </div>

    <ConfirmDialog
      isOpen={!!projectToDelete}
      onClose={() => setProjectToDelete(null)}
      onConfirm={confirmDeleteProject}
      title="Delete Project"
      message={`Are you sure you want to delete "${projectToDelete?.name}"? All tasks in this project will also be deleted. This action cannot be undone.`}
      confirmLabel="Delete"
      variant="danger"
      loading={isDeleting}
    />
    </>
  );
}

interface ProjectListItemProps {
  project: Project;
  isActive: boolean;
  onClick: () => void;
  onEdit: () => void;
  onDelete: () => void;
  progress: number;
}

function ProjectListItem({ project, isActive, onClick, onEdit, onDelete, progress }: ProjectListItemProps) {
  return (
    <div
      className={cn(
        "group w-full flex flex-col gap-1 px-2 py-1.5 rounded-md text-left text-sm cursor-pointer",
        "hover:bg-muted transition-colors",
        isActive && "bg-primary/10 text-primary"
      )}
      onClick={onClick}
    >
      <div className="flex items-center gap-3">
        <ProjectIcon
          icon={project.icon}
          size={16}
          weight={isActive ? "fill" : "duotone"}
          className={cn(
            "shrink-0",
            isActive ? "text-primary" : "text-muted-foreground"
          )}
        />
        <span className="flex-1 truncate">{project.name}</span>
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
          title="Edit"
        >
          <PencilSimple size={14} weight="duotone" className="text-muted-foreground" />
        </span>
        <span
          role="button"
          tabIndex={0}
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.stopPropagation();
              onDelete();
            }
          }}
          className="p-0.5 rounded hover:bg-muted opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
          title="Delete"
        >
          <Trash size={14} weight="duotone" className="text-muted-foreground" />
        </span>
      </div>

      {/* Progress bar */}
      <div className="pl-7 pr-2 opacity-50 text-[10px] flex items-center gap-2">
        <Progress value={progress} className="h-1" />
        <span className="w-6 text-right">{progress}%</span>
      </div>
    </div>
  );
}
