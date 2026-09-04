/** Slug collisions on rename raise ALREADY_EXISTS; the dialog catches that and offers to merge into the colliding tag. */

import { useCallback, useEffect, useMemo, useState } from "react";
import { CaretRight, Trash } from "@phosphor-icons/react";
import { Modal, ModalBody, ModalFooter, ModalHeader } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useAppDispatch, useAppSelector } from "@/app/hooks";
import { cn } from "@/shared/utils/cn";
import {
  deleteTagThunk,
  mergeTagsThunk,
  suggestTagsThunk,
  updateTagThunk,
  type SerializedTag,
} from "@/features/tags/store/tagsThunks";
import {
  TAG_PALETTE_SLUGS,
  getPaletteEntry,
  isTagPaletteSlug,
  type TagPaletteSlug,
} from "@/features/tags/utils/colors";
import { TagChip } from "@/features/tags/components/TagChip";

interface TagEditDialogProps {
  tag: SerializedTag;
  onClose: () => void;
}

const SLUG_COLLISION = "already exists";

export function TagEditDialog({ tag, onClose }: TagEditDialogProps) {
  const dispatch = useAppDispatch();
  const [name, setName] = useState(tag.name);
  const [description, setDescription] = useState(tag.description);
  const [color, setColor] = useState<string | null>(
    tag.color && isTagPaletteSlug(tag.color) ? tag.color : null,
  );
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [mergeMode, setMergeMode] = useState(false);
  const [mergeQuery, setMergeQuery] = useState("");
  const [mergeCandidate, setMergeCandidate] = useState<SerializedTag | null>(null);
  const tagsById = useAppSelector((s) => s.tags.byId);

  const previewTag = useMemo(() => ({ ...tag, name, color: color ?? "" }), [tag, name, color]);

  useEffect(() => {
    if (!mergeMode || mergeQuery.trim().length < 2) {
      return undefined;
    }
    const handle = window.setTimeout(async () => {
      const action = await dispatch(suggestTagsThunk({ prefix: mergeQuery.trim(), limit: 5 }));
      if (suggestTagsThunk.fulfilled.match(action)) {
        const candidates = action.payload.filter((t) => t.id !== tag.id);
        setMergeCandidate(candidates[0] ?? null);
      }
    }, 200);
    return () => window.clearTimeout(handle);
  }, [dispatch, mergeMode, mergeQuery, tag.id]);

  const handleSave = useCallback(async () => {
    setError(null);
    setIsSubmitting(true);
    try {
      const action = await dispatch(
        updateTagThunk({
          tagId: tag.id,
          name: name.trim(),
          color,
          description,
        }),
      );
      if (updateTagThunk.rejected.match(action)) {
        const message = (action.payload ?? action.error.message ?? "").toString();
        setError(message);
        if (message.toLowerCase().includes(SLUG_COLLISION)) {
          setMergeMode(true);
        }
        return;
      }
      onClose();
    } finally {
      setIsSubmitting(false);
    }
    // The deps below ARE read in the body; oxlint's memo analysis misses reads
    // inside try/finally blocks and object-literal call arguments.
    // eslint-disable-next-line react/react-compiler
  }, [color, description, dispatch, name, onClose, tag.id]);

  const handleDelete = useCallback(async () => {
    setIsSubmitting(true);
    const action = await dispatch(deleteTagThunk({ tagId: tag.id }));
    setIsSubmitting(false);
    if (deleteTagThunk.fulfilled.match(action)) onClose();
  }, [dispatch, onClose, tag.id]);

  const handleMerge = useCallback(async () => {
    if (!mergeCandidate) return;
    setIsSubmitting(true);
    const action = await dispatch(
      mergeTagsThunk({ sourceTagId: tag.id, targetTagId: mergeCandidate.id }),
    );
    setIsSubmitting(false);
    if (mergeTagsThunk.fulfilled.match(action)) onClose();
  }, [dispatch, mergeCandidate, onClose, tag.id]);

  return (
    <Modal onClose={onClose} closeDisabled={isSubmitting} maxWidth="max-w-md">
      <ModalHeader title="Edit tag" description="Changes apply everywhere the tag is used." />

      <ModalBody>
        <div>
          <label className="block text-sm text-muted-foreground mb-1">Preview</label>
          <TagChip tag={previewTag} nonInteractive />
        </div>

        <div>
          <label className="block text-sm text-muted-foreground mb-1" htmlFor="tag-name">
            Name
          </label>
          <Input
            id="tag-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={120}
          />
        </div>

        <div>
          <label className="block text-sm text-muted-foreground mb-1" htmlFor="tag-desc">
            Description (optional)
          </label>
          <Textarea
            id="tag-desc"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
            maxLength={500}
          />
        </div>

        <div>
          <label className="block text-sm text-muted-foreground mb-1">Color</label>
          <div className="grid grid-cols-6 gap-2">
            <button
              type="button"
              onClick={() => setColor(null)}
              className={cn(
                "grid h-8 w-8 place-items-center rounded-md border border-border bg-transparent",
                color === null && "ring-2 ring-primary",
              )}
              title="Workspace accent (default)"
            >
              <span className="text-[10px] text-muted-foreground">A</span>
            </button>
            {TAG_PALETTE_SLUGS.map((slug) => {
              const entry = getPaletteEntry(slug as TagPaletteSlug);
              const isSelected = color === slug;
              return (
                <button
                  key={slug}
                  type="button"
                  onClick={() => setColor(slug)}
                  className={cn(
                    "h-8 w-8 rounded-md border border-border transition-transform hover:scale-105",
                    entry.swatch,
                    isSelected && "ring-2 ring-primary ring-offset-2 ring-offset-background",
                  )}
                  title={slug}
                  aria-label={`Set color to ${slug}`}
                />
              );
            })}
          </div>
        </div>

        {mergeMode && (
          <div className="rounded-md border border-border bg-muted/40 p-3">
            <div className="text-xs font-medium text-foreground">
              Slug already exists. Merge into existing tag?
            </div>
            <Input
              type="text"
              value={mergeQuery}
              onChange={(e) => setMergeQuery(e.target.value)}
              placeholder="Search target tag..."
              className="mt-2"
            />
            {mergeCandidate && (
              <div className="mt-2 flex items-center justify-between">
                <TagChip tag={mergeCandidate} nonInteractive />
                <Button onClick={handleMerge} disabled={isSubmitting}>
                  Merge into <CaretRight size={12} weight="bold" /> {mergeCandidate.name}
                </Button>
              </div>
            )}
          </div>
        )}

        {error && (
          <p className="text-xs text-destructive" role="alert">
            {error}
          </p>
        )}
      </ModalBody>

      <ModalFooter>
        <Button
          variant="outline"
          onClick={() => setConfirmDelete(true)}
          disabled={isSubmitting}
          className="mr-auto text-destructive hover:bg-destructive/10"
        >
          <Trash size={14} weight="bold" />
          Delete
        </Button>
        <Button variant="ghost" onClick={onClose} disabled={isSubmitting}>
          Cancel
        </Button>
        <Button onClick={handleSave} disabled={isSubmitting}>
          {isSubmitting ? "Saving..." : "Save"}
        </Button>
      </ModalFooter>

      {confirmDelete && (
        <Modal
          onClose={() => setConfirmDelete(false)}
          closeDisabled={isSubmitting}
          maxWidth="max-w-sm"
        >
          <ModalHeader title={<>Delete &ldquo;{tag.name}&rdquo;?</>} />
          <ModalBody>
            <p className="text-sm text-muted-foreground">
              This removes the tag from every piece of content that carries it ({tag.usageCount}{" "}
              item{tag.usageCount === 1 ? "" : "s"}). This action cannot be undone.
            </p>
          </ModalBody>
          <ModalFooter>
            <Button variant="ghost" onClick={() => setConfirmDelete(false)} disabled={isSubmitting}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleDelete}
              loading={isSubmitting}
              disabled={isSubmitting}
            >
              {isSubmitting ? "Deleting..." : "Delete tag"}
            </Button>
          </ModalFooter>
        </Modal>
      )}

      {tagsById && false}
    </Modal>
  );
}
