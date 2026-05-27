import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Warning } from "@phosphor-icons/react";
import { useAppDispatch } from "@/app/hooks";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { deleteProject } from "@/features/projects/store/projectsThunks";
import type { Project } from "@/features/projects/types";

interface DangerZoneSectionProps {
  project: Project;
}

export function DangerZoneSection({ project }: DangerZoneSectionProps) {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();

  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [confirmName, setConfirmName] = useState("");
  const [isDeleting, setIsDeleting] = useState(false);

  const handleDelete = async () => {
    if (confirmName !== project.name) return;
    setIsDeleting(true);
    try {
      await dispatch(deleteProject(project.id)).unwrap();
      navigate("/projects");
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div className="space-y-8">
      {/* Section Header */}
      <div>
        <h1 className="text-2xl font-bold text-foreground mb-2 flex items-center gap-3">
          <Warning size={24} weight="duotone" className="text-red-500 shrink-0" />
          Danger Zone
        </h1>
        <p className="text-muted-foreground">
          Irreversible actions that affect the entire project.
        </p>
      </div>

      <div className="bg-card border border-red-500/20 rounded-lg p-4 md:p-6 space-y-6">
        {/* Delete Project */}
        <div>
          <h3 className="text-sm font-medium text-foreground mb-1">Delete this project</h3>
          <p className="text-sm text-muted-foreground mb-4">
            Permanently delete this project and all its tasks, sprints, custom fields, and views. This action cannot be undone.
          </p>

          {showDeleteConfirm ? (
            <div className="space-y-3 p-3 rounded-lg border border-red-500/20 bg-red-500/5">
              <p className="text-sm text-foreground">
                Type <strong>{project.name}</strong> to confirm:
              </p>
              <Input
                value={confirmName}
                onChange={(e) => setConfirmName(e.target.value)}
                placeholder={project.name}
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    setShowDeleteConfirm(false);
                    setConfirmName("");
                  }
                }}
              />
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setShowDeleteConfirm(false);
                    setConfirmName("");
                  }}
                  disabled={isDeleting}
                >
                  Cancel
                </Button>
                <Button
                  size="sm"
                  onClick={handleDelete}
                  disabled={confirmName !== project.name || isDeleting}
                  className="bg-red-600 hover:bg-red-700 text-white"
                >
                  {isDeleting ? "Deleting..." : "Delete Project"}
                </Button>
              </div>
            </div>
          ) : (
            <Button
              variant="outline"
              className="border-red-500/30 text-red-600 dark:text-red-400 hover:bg-red-500/10 hover:border-red-500/50"
              onClick={() => setShowDeleteConfirm(true)}
            >
              Delete Project
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
