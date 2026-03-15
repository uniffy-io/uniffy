/**
 * CreateProjectModal - Modal for creating a new project
 *
 * Simple form with name and optional description.
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { X, Kanban, LockSimple, Buildings } from "@phosphor-icons/react";
import { useNavigate } from "react-router-dom";
import { useAppDispatch, useAppSelector } from "@/app/hooks";
import { cn } from "@/shared/utils/cn";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { closeCreateProjectModal, selectProjectScope } from "@/features/projects/store/projectsUiSlice";
import { createProject, fetchProjectTasks } from "@/features/projects/store/projectsThunks";
import { ProjectIcon, type ProjectIconName } from "@/features/projects/utils/projectIcons";
import type { VisibilityScope } from "@/features/projects/types/project";

const ICON_OPTIONS: ProjectIconName[] = [
  "kanban",
  "rocket",
  "megaphone",
  "wrench",
  "lightning",
  "globe",
  "target",
  "bug",
  "palette",
  "star",
];

export function CreateProjectModal() {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const projectScope = useAppSelector(selectProjectScope);

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [icon, setIcon] = useState<ProjectIconName>("kanban");
  const [visibility, setVisibility] = useState<VisibilityScope>(
    projectScope === "organization" ? "ORGANIZATION" : "PRIVATE"
  );
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [slug, setSlug] = useState("");
  const [isSlugManuallyEdited, setIsSlugManuallyEdited] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Auto-generate slug from name when not manually edited
  useEffect(() => {
    if (isSlugManuallyEdited) return;
    const words = name.trim().split(/\s+/).filter(Boolean);
    let candidate: string;
    if (words.length >= 2) {
      candidate = words.map((w) => w[0]).join("").slice(0, 5).toUpperCase();
    } else {
      candidate = name.replace(/[^a-zA-Z0-9]/g, "").slice(0, 3).toUpperCase();
    }
    setSlug(candidate);
  }, [name, isSlugManuallyEdited]);

  // Focus input on mount
  useEffect(() => {
    const timer = setTimeout(() => inputRef.current?.focus(), 50);
    return () => clearTimeout(timer);
  }, []);

  const handleClose = useCallback(() => {
    setName("");
    setDescription("");
    setIcon("kanban");
    setVisibility(projectScope === "organization" ? "ORGANIZATION" : "PRIVATE");
    setIsSlugManuallyEdited(false);
    setSlug("");
    dispatch(closeCreateProjectModal());
  }, [dispatch, projectScope]);

  // Close on escape
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape" && !isSubmitting) {
        handleClose();
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isSubmitting, handleClose]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    setIsSubmitting(true);
    try {
      const result = await dispatch(
        createProject({
          name: name.trim(),
          description: description.trim(),
          icon,
          visibility,
          slug: slug || undefined,
        })
      ).unwrap();
      // Load tasks for the new project and navigate to it
      dispatch(fetchProjectTasks(result.id));
      navigate(`/projects/${result.id}`);
      handleClose();
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={() => !isSubmitting && handleClose()}
      />

      {/* Dialog */}
      <div className="relative bg-card w-full max-w-lg mx-4 rounded-xl shadow-2xl border border-border overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <div className="flex items-center gap-2">
            <Kanban size={20} weight="bold" className="text-primary" />
            <h3 className="text-lg font-semibold text-foreground">
              New Project
            </h3>
          </div>
          <button
            type="button"
            onClick={() => !isSubmitting && handleClose()}
            className="p-1 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit}>
          <div className="p-4 md:p-6 space-y-4 max-h-[60vh] overflow-y-auto">
            {/* Name */}
            <div>
              <label className="block text-sm font-medium text-foreground mb-1.5">
                Project Name
              </label>
              <Input
                ref={inputRef}
                type="text"
                placeholder="e.g. Product Launch Q2"
                value={name}
                onChange={(e) => setName(e.target.value)}
                disabled={isSubmitting}
              />
            </div>

            {/* Slug (key/identifier) */}
            <div>
              <label className="block text-sm font-medium text-foreground mb-1.5">
                Project Key
              </label>
              <div className="flex items-center gap-3">
                <Input
                  type="text"
                  value={slug}
                  onChange={(e) => {
                    setSlug(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 5));
                    setIsSlugManuallyEdited(true);
                  }}
                  maxLength={5}
                  disabled={isSubmitting}
                  className="w-32 font-mono"
                  placeholder="KEY"
                />
                <span className="text-xs text-muted-foreground">
                  Used for task IDs like {slug || "KEY"}-1
                </span>
              </div>
            </div>

            {/* Description */}
            <div>
              <label className="block text-sm font-medium text-foreground mb-1.5">
                Description
                <span className="text-muted-foreground font-normal ml-1">
                  (optional)
                </span>
              </label>
              <textarea
                placeholder="What is this project about?"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                disabled={isSubmitting}
                rows={2}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring resize-none"
              />
            </div>

            {/* Visibility */}
            <div>
              <label className="block text-sm font-medium text-foreground mb-1.5">
                Visibility
              </label>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setVisibility("PRIVATE")}
                  className={cn(
                    "flex items-center gap-2 px-3 py-2 rounded-md border text-sm transition-colors flex-1",
                    visibility === "PRIVATE"
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border text-muted-foreground hover:text-foreground hover:bg-muted"
                  )}
                >
                  <LockSimple size={16} weight="duotone" />
                  Personal
                </button>
                <button
                  type="button"
                  onClick={() => setVisibility("ORGANIZATION")}
                  className={cn(
                    "flex items-center gap-2 px-3 py-2 rounded-md border text-sm transition-colors flex-1",
                    visibility === "ORGANIZATION"
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border text-muted-foreground hover:text-foreground hover:bg-muted"
                  )}
                >
                  <Buildings size={16} weight="duotone" />
                  Organization
                </button>
              </div>
            </div>

            {/* Icon Picker */}
            <div>
              <label className="block text-sm font-medium text-foreground mb-1.5">
                Icon
              </label>
              <div className="flex flex-wrap gap-2">
                {ICON_OPTIONS.map((iconName) => (
                  <button
                    key={iconName}
                    type="button"
                    onClick={() => setIcon(iconName)}
                    className={`p-2 rounded-md border transition-colors ${
                      icon === iconName
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-border text-muted-foreground hover:text-foreground hover:bg-muted"
                    }`}
                  >
                    <ProjectIcon icon={iconName} size={20} weight="duotone" />
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Footer */}
          <div className="flex items-center justify-end gap-3 px-6 py-4 bg-muted/30 border-t border-border">
            <Button
              type="button"
              variant="outline"
              onClick={handleClose}
              disabled={isSubmitting}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={!name.trim() || isSubmitting}>
              {isSubmitting ? "Creating..." : "Create Project"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
