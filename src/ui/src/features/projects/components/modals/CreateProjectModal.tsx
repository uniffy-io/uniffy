import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { LockSimple, Buildings } from "@phosphor-icons/react";
import { AccessMode } from "@uniffy/proto/common/v1/common_pb";
import { useNavigate } from "react-router-dom";
import { useAppDispatch, useAppSelector } from "@/app/hooks";
import { cn } from "@/shared/utils/cn";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Modal, ModalBody, ModalFooter, ModalHeader } from "@/components/ui/modal";
import {
  closeCreateProjectModal,
  selectProjectScope,
} from "@/features/projects/store/projectsUiSlice";
import { createProject, fetchProjectTasks } from "@/features/projects/store/projectsThunks";
import { ProjectIcon, type ProjectIconName } from "@/features/projects/utils/projectIcons";
import { TagPicker, type TagPickerHandle } from "@/features/tags";

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

export function CreateProjectModal() {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const projectScope = useAppSelector(selectProjectScope);

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [icon, setIcon] = useState<ProjectIconName>("kanban");
  const [isOrgScope, setIsOrgScope] = useState(projectScope === "organization");
  const [isSubmitting, setIsSubmitting] = useState(false);
  // Null until the user types a key of their own; the name-derived suggestion applies until then.
  const [manualSlug, setManualSlug] = useState<string | null>(null);
  const [tagIds, setTagIds] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const tagPickerRef = useRef<TagPickerHandle>(null);

  const slug = useMemo(() => {
    if (manualSlug !== null) return manualSlug;
    const words = name.trim().split(/\s+/).filter(Boolean);
    if (words.length >= 2) {
      return words
        .map((w) => w[0])
        .join("")
        .slice(0, 5)
        .toUpperCase();
    }
    return name
      .replace(/[^a-zA-Z0-9]/g, "")
      .slice(0, 3)
      .toUpperCase();
  }, [manualSlug, name]);

  useEffect(() => {
    const timer = setTimeout(() => inputRef.current?.focus(), 50);
    return () => clearTimeout(timer);
  }, []);

  const handleClose = useCallback(() => {
    setName("");
    setDescription("");
    setIcon("kanban");
    setIsOrgScope(projectScope === "organization");
    setManualSlug(null);
    setTagIds([]);
    dispatch(closeCreateProjectModal());
  }, [dispatch, projectScope]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || isSubmitting) return;

    setIsSubmitting(true);
    try {
      const committedTagIds = (await tagPickerRef.current?.commit()) ?? null;
      if (committedTagIds === null) return;
      const result = await dispatch(
        createProject({
          name: name.trim(),
          description: description.trim(),
          icon,
          accessMode: isOrgScope ? AccessMode.OPEN_TO_ORG : AccessMode.OWNER_ONLY,
          slug: slug || undefined,
          tagIds: committedTagIds.length ? committedTagIds : undefined,
        }),
      ).unwrap();
      dispatch(fetchProjectTasks(result.id));
      navigate(`/projects/${result.id}`);
      handleClose();
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Modal onClose={handleClose} closeDisabled={isSubmitting}>
      <form onSubmit={handleSubmit}>
        <ModalHeader title="New project" />

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
            <label className="block text-sm text-muted-foreground mb-1">Project key</label>
            <div className="flex items-center gap-3">
              <Input
                type="text"
                value={slug}
                onChange={(e) =>
                  setManualSlug(
                    e.target.value
                      .toUpperCase()
                      .replace(/[^A-Z0-9]/g, "")
                      .slice(0, 5),
                  )
                }
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
              ref={tagPickerRef}
              selectedTagIds={tagIds}
              onChange={setTagIds}
              disabled={isSubmitting}
              placeholder="Add a tag"
            />
          </div>

          <div>
            <label className="block text-sm text-muted-foreground mb-1">Access</label>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setIsOrgScope(false)}
                className={cn(
                  "flex items-center gap-2 px-3 py-2 rounded-md border text-sm transition-colors flex-1",
                  !isOrgScope
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border text-muted-foreground hover:text-foreground hover:bg-muted",
                )}
              >
                <LockSimple size={16} weight="duotone" />
                Personal
              </button>
              <button
                type="button"
                onClick={() => setIsOrgScope(true)}
                className={cn(
                  "flex items-center gap-2 px-3 py-2 rounded-md border text-sm transition-colors flex-1",
                  isOrgScope
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border text-muted-foreground hover:text-foreground hover:bg-muted",
                )}
              >
                <Buildings size={16} weight="duotone" />
                Organization
              </button>
            </div>
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
        </ModalBody>

        <ModalFooter>
          <Button type="button" variant="ghost" onClick={handleClose} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button type="submit" disabled={!name.trim() || isSubmitting}>
            {isSubmitting ? "Creating..." : "Create project"}
          </Button>
        </ModalFooter>
      </form>
    </Modal>
  );
}
