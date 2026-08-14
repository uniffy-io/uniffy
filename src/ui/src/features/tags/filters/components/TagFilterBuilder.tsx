import { useCallback, useMemo, useState } from "react";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { IconPicker, renderIcon, type IconValue } from "@/components/icon-picker";
import { FilterRail } from "@/features/tags/filters/components/FilterRail";
import {
  type SerializedSavedTagFilter,
  type SerializedTagFilterCriteria,
  type SerializedTagFilterIcon,
} from "@/features/tags/store/tagsThunks";

export interface SaveTagFilterPayload {
  name: string;
  description: string;
  icon: SerializedTagFilterIcon | null;
  criteria: SerializedTagFilterCriteria;
  sortBy: string;
  sortOrder: string;
}

interface TagFilterBuilderProps {
  initial?: SerializedSavedTagFilter | null;
  initialCriteria: SerializedTagFilterCriteria;
  onClose: () => void;
  onSubmit: (payload: SaveTagFilterPayload) => Promise<void> | void;
}

const SORT_OPTIONS = [
  { value: "count", label: "Tag count" },
  { value: "alpha", label: "Alphabetical" },
  { value: "updated", label: "Updated" },
] as const;

const SORT_ORDER_OPTIONS = [
  { value: "desc", label: "Descending" },
  { value: "asc", label: "Ascending" },
] as const;

export function TagFilterBuilder({
  initial,
  initialCriteria,
  onClose,
  onSubmit,
}: TagFilterBuilderProps) {
  const [name, setName] = useState(initial?.name ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [icon, setIcon] = useState<SerializedTagFilterIcon | null>(initial?.icon ?? null);
  const [criteria, setCriteria] = useState<SerializedTagFilterCriteria>(
    initial?.criteria ?? initialCriteria,
  );
  const [sortBy, setSortBy] = useState(initial?.sortBy ?? "count");
  const [sortOrder, setSortOrder] = useState(initial?.sortOrder ?? "desc");
  const [iconPickerOpen, setIconPickerOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const canSubmit = useMemo(() => name.trim().length > 0, [name]);

  const handleSubmit = useCallback(async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      await onSubmit({
        name: name.trim(),
        description,
        icon,
        criteria,
        sortBy,
        sortOrder,
      });
    } finally {
      setSubmitting(false);
    }
  }, [canSubmit, criteria, description, icon, name, onSubmit, sortBy, sortOrder]);

  return (
    <Modal onClose={onClose} maxWidth="max-w-3xl">
      <div className="border-b border-border px-5 py-3">
        <h2 className="text-base font-semibold">
          {initial ? "Edit saved filter" : "Save filter as..."}
        </h2>
      </div>
      <div className="grid grid-cols-1 gap-4 px-5 py-4 md:grid-cols-2">
        <div className="space-y-3">
          <div>
            <label className="text-xs font-medium text-muted-foreground" htmlFor="filter-name">
              Name
            </label>
            <input
              id="filter-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="mt-1.5 block w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm focus:border-primary focus:outline-none"
              maxLength={120}
              autoFocus
            />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground" htmlFor="filter-desc">
              Description
            </label>
            <textarea
              id="filter-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              className="mt-1.5 block w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm focus:border-primary focus:outline-none"
              maxLength={500}
            />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground">Icon</label>
            <div className="mt-1.5 flex items-center gap-2">
              <button
                type="button"
                onClick={() => setIconPickerOpen((v) => !v)}
                className="flex h-9 w-9 items-center justify-center rounded-md border border-border bg-background hover:bg-muted"
              >
                {icon ? (
                  renderIcon(icon as IconValue, undefined, 18)
                ) : (
                  <span className="text-xs text-muted-foreground">+</span>
                )}
              </button>
              {icon && (
                <button
                  type="button"
                  onClick={() => setIcon(null)}
                  className="text-xs text-muted-foreground hover:text-destructive"
                >
                  Clear
                </button>
              )}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-xs font-medium text-muted-foreground">Sort by</label>
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value)}
                className="mt-1.5 block w-full rounded-md border border-border bg-background px-2 py-1 text-sm focus:border-primary focus:outline-none"
              >
                {SORT_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Order</label>
              <select
                value={sortOrder}
                onChange={(e) => setSortOrder(e.target.value)}
                className="mt-1.5 block w-full rounded-md border border-border bg-background px-2 py-1 text-sm focus:border-primary focus:outline-none"
              >
                {SORT_ORDER_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>
        <div className="border-l border-border md:pl-4">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Criteria
          </h3>
          <div className="max-h-96 overflow-y-auto rounded-md border border-border">
            <FilterRail criteria={criteria} onChange={setCriteria} />
          </div>
        </div>
      </div>
      <div className="flex items-center justify-end gap-2 border-t border-border px-5 py-3">
        <Button variant="outline" size="sm" onClick={onClose} disabled={submitting}>
          Cancel
        </Button>
        <Button size="sm" onClick={handleSubmit} disabled={!canSubmit || submitting}>
          {submitting ? "Saving..." : initial ? "Save changes" : "Save filter"}
        </Button>
      </div>

      {iconPickerOpen && (
        <Modal onClose={() => setIconPickerOpen(false)} maxWidth="max-w-md">
          <IconPicker
            currentIcon={(icon as IconValue) ?? null}
            onSelect={(next) => {
              setIcon(
                next
                  ? {
                      type: next.type === "emoji" ? "emoji" : "icon",
                      value: next.value,
                    }
                  : null,
              );
              setIconPickerOpen(false);
            }}
            onClose={() => setIconPickerOpen(false)}
            showRemove
          />
        </Modal>
      )}
    </Modal>
  );
}
