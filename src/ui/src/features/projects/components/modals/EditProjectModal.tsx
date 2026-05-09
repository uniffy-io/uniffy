/**
 * EditProjectModal - Modal for editing an existing project
 *
 * Allows editing name, description, visibility, and icon.
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { X, PencilSimple } from "@phosphor-icons/react";
import { useAppDispatch, useAppSelector } from "@/app/hooks";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { closeEditProjectModal, selectEditProjectId } from "@/features/projects/store/projectsUiSlice";
import { selectProjects } from "@/features/projects/store/projectsSlice";
import { updateProject } from "@/features/projects/store/projectsThunks";
import { ProjectIcon, type ProjectIconName } from "@/features/projects/utils/projectIcons";
import type { TypeFieldSchema } from "@/features/projects/types/project";
import { TypeFieldSchemasSection } from "@/features/projects/components/settings/TypeFieldSchemasSection";
import { TagPicker } from "@/features/tags";

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

export function EditProjectModal() {
  const dispatch = useAppDispatch();
  const editProjectId = useAppSelector(selectEditProjectId);
  const projects = useAppSelector(selectProjects);
  const project = projects.find((p) => p.id === editProjectId);

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [icon, setIcon] = useState<ProjectIconName>("kanban");
  const [typeFieldSchemas, setTypeFieldSchemas] = useState<Record<string, TypeFieldSchema>>({});
  const [tagIds, setTagIds] = useState<string[]>([]);
  const [tagsDirty, setTagsDirty] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Populate form when project changes
  useEffect(() => {
    if (project) {
      setName(project.name);
      setDescription(project.description || "");
      setIcon((project.icon || "kanban") as ProjectIconName);
      setTypeFieldSchemas(project.typeFieldSchemas || {});
      setTagIds(project.tagIds ?? []);
      setTagsDirty(false);
    }
  }, [project]);

  // Focus input on mount
  useEffect(() => {
    if (editProjectId) {
      const timer = setTimeout(() => inputRef.current?.focus(), 50);
      return () => clearTimeout(timer);
    }
  }, [editProjectId]);

  const handleClose = useCallback(() => {
    dispatch(closeEditProjectModal());
  }, [dispatch]);

  if (!project || !editProjectId) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    setIsSubmitting(true);
    try {
      await dispatch(
        updateProject({
          id: project.id,
          name: name.trim(),
          description: description.trim(),
          icon,
          typeFieldSchemas,
          ...(tagsDirty ? { tagIds } : {}),
        })
      ).unwrap();
      handleClose();
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Modal onClose={handleClose} closeDisabled={isSubmitting}>
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-border">
        <div className="flex items-center gap-2">
          <PencilSimple size={20} weight="bold" className="text-primary" />
          <h3 className="text-lg font-semibold text-foreground">
            Edit Project
          </h3>
        </div>
        <button
          type="button"
          onClick={handleClose}
          disabled={isSubmitting}
          className="p-1 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:opacity-50"
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

            {/* Tags */}
            <div>
              <label className="block text-sm font-medium text-foreground mb-1.5">
                Tags
                <span className="text-muted-foreground font-normal ml-1">
                  (optional)
                </span>
              </label>
              <TagPicker
                selectedTagIds={tagIds}
                onChange={(next) => {
                  setTagIds(next);
                  setTagsDirty(true);
                }}
                disabled={isSubmitting}
                placeholder="Add a tag"
              />
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

            {/* Type Field Schemas */}
            <TypeFieldSchemasSection
              fieldDefinitions={project.fieldDefinitions}
              typeFieldSchemas={typeFieldSchemas}
              onChange={setTypeFieldSchemas}
            />
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
              {isSubmitting ? "Saving..." : "Save Changes"}
            </Button>
          </div>
        </form>
    </Modal>
  );
}
