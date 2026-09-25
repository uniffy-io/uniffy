import { useState, useEffect, useRef } from "react";
import { Gear, Check } from "@phosphor-icons/react";
import { useAppDispatch } from "@/app/hooks";
import { cn } from "@/shared/utils/cn";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { TagPicker, type TagPickerHandle } from "@/features/tags";
import { updateProject } from "@/features/projects/store/projectsThunks";
import { ProjectIcon, type ProjectIconName } from "@/features/projects/utils/projectIcons";
import type { Project } from "@/features/projects/types";

const ICON_OPTIONS: ProjectIconName[] = [
  "kanban",
  "rocket",
  "megaphone",
  "wrench",
  "globe",
  "target",
  "palette",
  "cart",
  "graduation",
  "trophy",
  "cube",
  "heart",
];

function sameIds(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((id) => b.includes(id));
}

interface GeneralSectionProps {
  project: Project;
}

export function GeneralSection({ project }: GeneralSectionProps) {
  const dispatch = useAppDispatch();
  const inputRef = useRef<HTMLInputElement>(null);
  const tagPickerRef = useRef<TagPickerHandle>(null);
  const sourceRef = useRef(project);

  const [name, setName] = useState(project.name);
  const [description, setDescription] = useState(project.description || "");
  const [slug, setSlug] = useState(project.slug || "");
  const [icon, setIcon] = useState<ProjectIconName>((project.icon || "kanban") as ProjectIconName);
  const [tagIds, setTagIds] = useState<string[]>(project.tagIds ?? []);
  const [hasPendingTag, setHasPendingTag] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    const previous = sourceRef.current;
    sourceRef.current = project;
    if (
      previous.id === project.id &&
      previous.name === project.name &&
      previous.description === project.description &&
      previous.slug === project.slug &&
      previous.icon === project.icon &&
      sameIds(previous.tagIds ?? [], project.tagIds ?? [])
    )
      return;

    // Only changed server values replace a draft; equivalent refreshes keep local edits.
    // eslint-disable-next-line react/react-compiler
    setName(project.name);
    setDescription(project.description || "");
    setSlug(project.slug || "");
    setIcon((project.icon || "kanban") as ProjectIconName);
    setTagIds(project.tagIds ?? []);
  }, [project]);

  const tagsChanged = !sameIds(tagIds, project.tagIds ?? []);

  const isDirty =
    name !== project.name ||
    description !== (project.description || "") ||
    slug !== (project.slug || "") ||
    icon !== (project.icon || "kanban") ||
    tagsChanged;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || (!isDirty && !hasPendingTag) || isSubmitting) return;

    setIsSubmitting(true);
    try {
      const committedTagIds = (await tagPickerRef.current?.commit()) ?? null;
      if (committedTagIds === null) return;
      await dispatch(
        updateProject({
          id: project.id,
          name: name.trim(),
          description: description.trim(),
          icon,
          slug: slug.trim(),
          ...(!sameIds(committedTagIds, project.tagIds ?? []) ? { tagIds: committedTagIds } : {}),
        }),
      ).unwrap();
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-foreground mb-2 flex items-center gap-3">
          <Gear size={24} weight="duotone" className="text-primary shrink-0" />
          General
        </h1>
        <p className="text-muted-foreground">Basic project information.</p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        <section className="space-y-4">
          <h2 className="text-lg font-semibold text-foreground">Basic Information</h2>
          <div className="space-y-4 rounded-xl bg-surface p-4 shadow-edge md:p-6">
            <div>
              <label className="block text-sm text-muted-foreground mb-1">Project Name</label>
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
                Description
                <span className="text-muted-foreground font-normal ml-1">(optional)</span>
              </label>
              <Textarea
                placeholder="What is this project about?"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                disabled={isSubmitting}
                rows={3}
              />
            </div>

            <div>
              <label className="block text-sm text-muted-foreground mb-1">
                Tags
                <span className="text-muted-foreground font-normal ml-1">(optional)</span>
              </label>
              <TagPicker
                key={project.id}
                ref={tagPickerRef}
                selectedTagIds={tagIds}
                onChange={setTagIds}
                onPendingChange={setHasPendingTag}
                disabled={isSubmitting}
                placeholder="Add a tag"
              />
            </div>

            <div>
              <label className="block text-sm text-muted-foreground mb-1">
                Slug
                <span className="text-muted-foreground font-normal ml-1">
                  (used in task IDs like SLUG-123)
                </span>
              </label>
              <Input
                type="text"
                placeholder="e.g. PROD"
                value={slug}
                maxLength={5}
                onChange={(e) => setSlug(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))}
                disabled={isSubmitting}
              />
            </div>
          </div>
        </section>

        <section className="space-y-4">
          <h2 className="text-lg font-semibold text-foreground">Icon</h2>
          <div className="rounded-xl bg-surface p-4 shadow-edge md:p-6">
            <div className="flex flex-wrap gap-2">
              {ICON_OPTIONS.map((iconName) => (
                <button
                  key={iconName}
                  type="button"
                  disabled={isSubmitting}
                  onClick={() => setIcon(iconName)}
                  className={cn(
                    "p-2 rounded-md transition-shadow duration-150",
                    icon === iconName
                      ? "bg-primary/5 text-primary shadow-edge-primary"
                      : "text-muted-foreground shadow-edge hover:text-foreground hover:shadow-edge-strong",
                  )}
                >
                  <ProjectIcon icon={iconName} size={20} weight="duotone" />
                </button>
              ))}
            </div>
          </div>
        </section>

        <div className="flex items-center gap-3">
          <Button
            type="submit"
            disabled={!name.trim() || (!isDirty && !hasPendingTag) || isSubmitting}
          >
            {isSubmitting ? "Saving..." : "Save Changes"}
          </Button>
          {saved && (
            <span className="flex items-center gap-1 text-sm text-green-600 dark:text-green-400">
              <Check size={16} weight="bold" />
              Saved
            </span>
          )}
        </div>
      </form>
    </div>
  );
}
