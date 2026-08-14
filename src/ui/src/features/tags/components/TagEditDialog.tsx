/** Slug collisions on rename raise ALREADY_EXISTS; the dialog catches that and offers to merge into the colliding tag. */

import { useCallback, useEffect, useMemo, useState } from "react";
import { CaretRight, Trash, X } from "@phosphor-icons/react";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
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
    <Modal onClose={onClose} maxWidth="max-w-md">
      <div className="border-b border-border px-5 py-3">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-foreground">Edit tag</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <X size={16} weight="bold" />
          </button>
        </div>
      </div>

      <div className="space-y-4 px-5 py-4">
        <div>
          <label className="text-xs font-medium text-muted-foreground">Preview</label>
          <div className="mt-1.5">
            <TagChip tag={previewTag} nonInteractive />
          </div>
        </div>

        <div>
          <label className="text-xs font-medium text-muted-foreground" htmlFor="tag-name">
            Name
          </label>
          <input
            id="tag-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="mt-1.5 block w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm focus:border-primary focus:outline-none"
            maxLength={120}
          />
        </div>

        <div>
          <label className="text-xs font-medium text-muted-foreground" htmlFor="tag-desc">
            Description
          </label>
          <textarea
            id="tag-desc"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
            className="mt-1.5 block w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm focus:border-primary focus:outline-none"
            maxLength={500}
          />
        </div>

        <div>
          <label className="text-xs font-medium text-muted-foreground">Color</label>
          <div className="mt-2 grid grid-cols-6 gap-2">
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
            <input
              type="text"
              value={mergeQuery}
              onChange={(e) => setMergeQuery(e.target.value)}
              placeholder="Search target tag..."
              className="mt-2 block w-full rounded-md border border-border bg-background px-2 py-1 text-sm focus:border-primary focus:outline-none"
            />
            {mergeCandidate && (
              <div className="mt-2 flex items-center justify-between">
                <TagChip tag={mergeCandidate} nonInteractive />
                <Button size="sm" onClick={handleMerge} disabled={isSubmitting}>
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
      </div>

      <div className="flex items-center gap-2 border-t border-border px-5 py-3">
        <Button
          variant="outline"
          size="sm"
          onClick={() => setConfirmDelete(true)}
          disabled={isSubmitting}
          className="text-destructive hover:bg-destructive/10"
        >
          <Trash size={14} weight="bold" className="mr-1" />
          Delete
        </Button>
        <div className="flex-1" />
        <Button variant="outline" size="sm" onClick={onClose} disabled={isSubmitting}>
          Cancel
        </Button>
        <Button size="sm" onClick={handleSave} disabled={isSubmitting}>
          {isSubmitting ? "Saving..." : "Save"}
        </Button>
      </div>

      {confirmDelete && (
        <Modal onClose={() => setConfirmDelete(false)} maxWidth="max-w-sm">
          <div className="px-5 py-4">
            <h3 className="text-base font-semibold">Delete &ldquo;{tag.name}&rdquo;?</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              This removes the tag from every piece of content that carries it ({tag.usageCount}{" "}
              item{tag.usageCount === 1 ? "" : "s"}). This action cannot be undone.
            </p>
          </div>
          <div className="flex items-center justify-end gap-2 border-t border-border px-5 py-3">
            <Button variant="outline" size="sm" onClick={() => setConfirmDelete(false)}>
              Cancel
            </Button>
            <Button variant="destructive" size="sm" onClick={handleDelete} disabled={isSubmitting}>
              {isSubmitting ? "Deleting..." : "Delete tag"}
            </Button>
          </div>
        </Modal>
      )}

      {tagsById && false}
    </Modal>
  );
}
