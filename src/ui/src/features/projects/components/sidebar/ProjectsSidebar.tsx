/**
 * ProjectsSidebar - Left navigation sidebar
 *
 * Contains:
 * - Header with "Projects" title and + button
 * - List of all projects with icons
 * - Current project highlighted
 */

import { useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { Plus, Kanban, Trash } from "@phosphor-icons/react";
import { useAppSelector, useAppDispatch } from "@/app/hooks";
import { cn } from "@/shared/utils/cn";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  selectProjects,
  selectCurrentProjectId,
  setCurrentProject,
  selectProjectCompletion,
} from "@/features/projects/store/projectsSlice";
import { deleteProject } from "@/features/projects/store/projectsThunks";
import { openCreateProjectModal, selectProjectScope } from "@/features/projects/store/projectsUiSlice";
import { ProjectIcon } from "@/features/projects/utils/projectIcons";
import { ProjectScopeFilter } from "@/features/projects/components/sidebar/ProjectScopeFilter";
import { Progress } from "@/components/ui/progress";
import type { Project } from "@/features/projects/types";

export function ProjectsSidebar() {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
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
  };

  const [projectToDelete, setProjectToDelete] = useState<Project | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const handleCreateProject = () => {
    dispatch(openCreateProjectModal());
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
      {/* Header */}
      <div className="flex items-center justify-between px-3 pt-3 pb-2">
        <div className="flex items-center gap-2">
          <Kanban size={20} weight="duotone" className="text-primary" />
          <span className="font-semibold text-foreground">Projects</span>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 text-primary"
          onClick={handleCreateProject}
        >
          <Plus size={16} />
        </Button>
      </div>

      {/* Scope Filter */}
      <ProjectScopeFilter />

      {/* Project List */}
      <ScrollArea className="flex-1">
        <div className="px-2 pt-2 space-y-0.5">
          {filteredProjects.length === 0 ? (
            <div className="px-2 py-8 text-center text-xs text-muted-foreground">
              {projects.length === 0 ? (
                <>
                  <p>No projects yet</p>
                  <Button
                    variant="link"
                    size="sm"
                    className="mt-2"
                    onClick={handleCreateProject}
                  >
                    Create your first project
                  </Button>
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
  onDelete: () => void;
  progress: number;
}

function ProjectListItem({ project, isActive, onClick, onDelete, progress }: ProjectListItemProps) {
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
            onDelete();
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.stopPropagation();
              onDelete();
            }
          }}
          className="p-0.5 rounded hover:bg-destructive/10 opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
          title="Delete"
        >
          <Trash size={14} weight="duotone" className="text-destructive" />
        </span>
      </div>
      
      {/* Feature 14: Project Progress */}
      <div className="pl-7 pr-2 opacity-50 text-[10px] flex items-center gap-2">
        <Progress value={progress} className="h-1" />
        <span className="w-6 text-right">{progress}%</span>
      </div>
    </div>
  );
}
