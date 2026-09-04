import { useState, useEffect, useRef, useCallback } from "react";
import { useAppDispatch, useAppSelector } from "@/app/hooks";
import { cn } from "@/shared/utils/cn";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Modal, ModalBody, ModalFooter, ModalHeader } from "@/components/ui/modal";
import {
  closeEditProjectModal,
  selectEditProjectId,
} from "@/features/projects/store/projectsUiSlice";
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
  "globe",
  "target",
  "palette",
  "cube",
  "trophy",
  "heart",
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

  // The modal stays mounted and only renders null while closed, so seed the form per project.
  useEffect(() => {
    if (project) {
      // eslint-disable-next-line react/react-compiler
      setName(project.name);
      setDescription(project.description || "");
      setIcon((project.icon || "kanban") as ProjectIconName);
      setTypeFieldSchemas(project.typeFieldSchemas || {});
      setTagIds(project.tagIds ?? []);
      setTagsDirty(false);
    }
  }, [project]);

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
        }),
      ).unwrap();
      handleClose();
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Modal onClose={handleClose} closeDisabled={isSubmitting}>
      <form onSubmit={handleSubmit}>
        <ModalHeader title="Edit project" />

        <ModalBody>
          <div>
            <label className="block text-sm text-muted-foreground mb-1">Name</label>
            <Input
              ref={inputRef}
              type="text"
              placeholder="e.g. Product Launch Q2"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={isSubmitting}
            />
          </div>

          <div>
            <label className="block text-sm text-muted-foreground mb-1">
              Description (optional)
            </label>
            <Textarea
              placeholder="What is this project about?"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              disabled={isSubmitting}
              rows={2}
            />
          </div>

          <div>
            <label className="block text-sm text-muted-foreground mb-1">Tags (optional)</label>
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

          <div>
            <label className="block text-sm text-muted-foreground mb-1">Icon</label>
            <div className="flex flex-wrap gap-2">
              {ICON_OPTIONS.map((iconName) => (
                <button
                  key={iconName}
                  type="button"
                  onClick={() => setIcon(iconName)}
                  className={cn(
                    "p-2 rounded-md border transition-colors",
                    icon === iconName
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border text-muted-foreground hover:text-foreground hover:bg-muted",
                  )}
                >
                  <ProjectIcon icon={iconName} size={20} weight="duotone" />
                </button>
              ))}
            </div>
          </div>

          <TypeFieldSchemasSection
            fieldDefinitions={project.fieldDefinitions}
            typeFieldSchemas={typeFieldSchemas}
            onChange={setTypeFieldSchemas}
          />
        </ModalBody>

        <ModalFooter>
          <Button type="button" variant="ghost" onClick={handleClose} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button type="submit" disabled={!name.trim() || isSubmitting}>
            {isSubmitting ? "Saving..." : "Save changes"}
          </Button>
        </ModalFooter>
      </form>
    </Modal>
  );
}
