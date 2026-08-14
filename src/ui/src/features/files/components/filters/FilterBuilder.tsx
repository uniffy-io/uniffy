import { useState, useCallback } from "react";
import {
  X,
  Plus,
  Image,
  FileDoc,
  Video,
  MusicNote,
  FileArchive,
  Funnel,
} from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { IconPicker, renderIcon, type IconValue } from "@/components/icon-picker";
import { cn } from "@/shared/utils/cn";
import { TagPicker } from "@/features/tags";
import type {
  SerializedFilterCriteria,
  SerializedSavedFilter,
  SerializedIconValue,
} from "@/features/files/store/savedFiltersSlice";

interface FilterBuilderProps {
  initialFilter?: SerializedSavedFilter;
  onSave: (params: {
    name: string;
    description?: string;
    icon?: SerializedIconValue;
    criteria: SerializedFilterCriteria;
    sortBy?: string;
    sortOrder?: string;
  }) => Promise<void>;
  onCancel: () => void;
  saving?: boolean;
}

const MIME_CATEGORIES = [
  { id: "document", label: "Documents", icon: FileDoc },
  { id: "image", label: "Images", icon: Image },
  { id: "video", label: "Videos", icon: Video },
  { id: "audio", label: "Audio", icon: MusicNote },
  { id: "archive", label: "Archives", icon: FileArchive },
];

const COMMON_EXTENSIONS = [
  "pdf",
  "doc",
  "docx",
  "xls",
  "xlsx",
  "ppt",
  "pptx",
  "jpg",
  "jpeg",
  "png",
  "gif",
  "svg",
  "webp",
  "mp4",
  "mov",
  "avi",
  "mkv",
  "webm",
  "mp3",
  "wav",
  "ogg",
  "flac",
  "zip",
  "rar",
  "7z",
  "tar",
  "gz",
  "txt",
  "md",
  "json",
  "xml",
  "csv",
];

const SORT_OPTIONS = [
  { value: "updated_at", label: "Date Modified" },
  { value: "created_at", label: "Date Created" },
  { value: "filename", label: "Name" },
  { value: "size_bytes", label: "Size" },
];

const SIZE_PRESETS = [
  { label: "< 1 MB", min: undefined, max: 1048576 },
  { label: "1-10 MB", min: 1048576, max: 10485760 },
  { label: "10-100 MB", min: 10485760, max: 104857600 },
  { label: "> 100 MB", min: 104857600, max: undefined },
];

export function FilterBuilder({
  initialFilter,
  onSave,
  onCancel,
  saving = false,
}: FilterBuilderProps) {
  const [name, setName] = useState(initialFilter?.name ?? "");
  const [description, setDescription] = useState(initialFilter?.description ?? "");
  const [selectedCategories, setSelectedCategories] = useState<string[]>(
    initialFilter?.criteria.mimeCategories ?? [],
  );
  const [extensions, setExtensions] = useState<string[]>(initialFilter?.criteria.extensions ?? []);
  const [extensionInput, setExtensionInput] = useState("");
  const [tagIds, setTagIds] = useState<string[]>(initialFilter?.criteria.tagIds ?? []);
  const [sizeMin, setSizeMin] = useState<number | undefined>(initialFilter?.criteria.sizeMinBytes);
  const [sizeMax, setSizeMax] = useState<number | undefined>(initialFilter?.criteria.sizeMaxBytes);
  const [sortBy, setSortBy] = useState(initialFilter?.sortBy ?? "updated_at");
  const [sortOrder, setSortOrder] = useState(initialFilter?.sortOrder ?? "desc");

  const [icon, setIcon] = useState<SerializedIconValue | undefined>(initialFilter?.icon);
  const [isIconPickerOpen, setIsIconPickerOpen] = useState(false);

  const [error, setError] = useState<string | null>(null);

  const handleCategoryToggle = useCallback((categoryId: string) => {
    setSelectedCategories((prev) =>
      prev.includes(categoryId) ? prev.filter((c) => c !== categoryId) : [...prev, categoryId],
    );
  }, []);

  const handleAddExtension = useCallback(() => {
    const ext = extensionInput.trim().toLowerCase().replace(/^\./, "");
    if (ext && !extensions.includes(ext)) {
      setExtensions((prev) => [...prev, ext]);
      setExtensionInput("");
    }
  }, [extensionInput, extensions]);

  const handleRemoveExtension = useCallback((ext: string) => {
    setExtensions((prev) => prev.filter((e) => e !== ext));
  }, []);

  const handleSizePreset = useCallback((min: number | undefined, max: number | undefined) => {
    setSizeMin(min);
    setSizeMax(max);
  }, []);

  const handleClearSize = useCallback(() => {
    setSizeMin(undefined);
    setSizeMax(undefined);
  }, []);

  const handleIconSelect = useCallback((newIcon: IconValue | null) => {
    setIcon(newIcon ? { type: newIcon.type, value: newIcon.value } : undefined);
    setIsIconPickerOpen(false);
  }, []);

  const handleSave = useCallback(async () => {
    if (!name.trim()) {
      setError("Filter name is required");
      return;
    }

    const criteria: SerializedFilterCriteria = {};

    if (selectedCategories.length > 0) {
      criteria.mimeCategories = selectedCategories;
    }
    if (extensions.length > 0) {
      criteria.extensions = extensions;
    }
    if (tagIds.length > 0) {
      criteria.tagIds = tagIds;
    }
    if (sizeMin !== undefined) {
      criteria.sizeMinBytes = sizeMin;
    }
    if (sizeMax !== undefined) {
      criteria.sizeMaxBytes = sizeMax;
    }

    try {
      await onSave({
        name: name.trim(),
        description: description.trim() || undefined,
        icon,
        criteria,
        sortBy,
        sortOrder,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save filter");
    }
  }, [
    name,
    description,
    icon,
    selectedCategories,
    extensions,
    tagIds,
    sizeMin,
    sizeMax,
    sortBy,
    sortOrder,
    onSave,
  ]);

  const handleCategoryToggleWithClear = useCallback(
    (categoryId: string) => {
      handleCategoryToggle(categoryId);
      if (error) setError(null);
    },
    [handleCategoryToggle, error],
  );

  const handleNameChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setName(e.target.value);
      if (error) setError(null);
    },
    [error],
  );

  return (
    <div className="bg-card border border-border rounded-lg">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-border">
        <h2 className="text-lg font-semibold">{initialFilter ? "Edit Filter" : "Create Filter"}</h2>
        <button onClick={onCancel} className="p-1.5 rounded-md hover:bg-muted transition-colors">
          <X size={18} weight="bold" className="text-muted-foreground" />
        </button>
      </div>

      {/* Form */}
      <div className="p-6 space-y-6">
        {/* Error */}
        {error && (
          <div className="p-3 rounded-md bg-destructive/10 border border-destructive/30">
            <p className="text-sm text-destructive">{error}</p>
          </div>
        )}

        {/* Name and Icon */}
        <div className="flex gap-4">
          {/* Icon Picker */}
          <div className="relative">
            <label className="block text-sm font-medium mb-1.5">Icon</label>
            <button
              type="button"
              onClick={() => setIsIconPickerOpen(!isIconPickerOpen)}
              className="w-12 h-10 flex items-center justify-center bg-background border border-input rounded-md hover:border-primary/50 transition-colors"
            >
              {icon ? (
                icon.type === "emoji" ? (
                  <span className="text-lg">{icon.value}</span>
                ) : (
                  renderIcon(icon, undefined, 20)
                )
              ) : (
                <Funnel size={20} className="text-muted-foreground" />
              )}
            </button>
            {isIconPickerOpen && (
              <IconPicker
                currentIcon={icon ? { type: icon.type, value: icon.value } : null}
                onSelect={handleIconSelect}
                onClose={() => setIsIconPickerOpen(false)}
                title="Filter Icon"
                showRemove={!!icon}
                className="left-0 top-full"
              />
            )}
          </div>

          {/* Name */}
          <div className="flex-1">
            <label className="block text-sm font-medium mb-1.5">
              Filter Name <span className="text-destructive">*</span>
            </label>
            <input
              type="text"
              value={name}
              onChange={handleNameChange}
              placeholder="e.g., My Images, Work Documents"
              className="w-full px-3 py-2 bg-background border border-input rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-ring"
              maxLength={100}
            />
          </div>
        </div>

        {/* Description */}
        <div>
          <label className="block text-sm font-medium mb-1.5">Description</label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Optional description of what this filter finds..."
            rows={2}
            className="w-full px-3 py-2 bg-background border border-input rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-ring resize-none"
            maxLength={500}
          />
        </div>

        {/* File Types (MIME Categories) */}
        <div>
          <label className="block text-sm font-medium mb-2">File Types</label>
          <div className="flex flex-wrap gap-2">
            {MIME_CATEGORIES.map((cat) => {
              const Icon = cat.icon;
              const isSelected = selectedCategories.includes(cat.id);
              return (
                <button
                  key={cat.id}
                  type="button"
                  onClick={() => handleCategoryToggleWithClear(cat.id)}
                  className={cn(
                    "inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md border transition-colors",
                    isSelected
                      ? "bg-primary text-primary-foreground border-primary"
                      : "bg-background border-input hover:border-primary/50",
                  )}
                >
                  <Icon size={16} weight={isSelected ? "fill" : "duotone"} />
                  {cat.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* File Extensions */}
        <div>
          <label className="block text-sm font-medium mb-2">File Extensions</label>
          <div className="flex gap-2 mb-2">
            <input
              type="text"
              value={extensionInput}
              onChange={(e) => setExtensionInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), handleAddExtension())}
              placeholder="e.g., pdf, docx"
              className="flex-1 px-3 py-1.5 bg-background border border-input rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-ring"
            />
            <Button variant="outline" size="sm" onClick={handleAddExtension}>
              <Plus size={14} weight="bold" />
            </Button>
          </div>

          {/* Selected extensions */}
          {extensions.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mb-2">
              {extensions.map((ext) => (
                <span
                  key={ext}
                  className="inline-flex items-center gap-1 px-2 py-0.5 bg-muted rounded text-xs"
                >
                  .{ext}
                  <button
                    onClick={() => handleRemoveExtension(ext)}
                    className="hover:text-destructive"
                  >
                    <X size={12} weight="bold" />
                  </button>
                </span>
              ))}
            </div>
          )}

          {/* Common extensions */}
          <div className="flex flex-wrap gap-1">
            {COMMON_EXTENSIONS.filter((e) => !extensions.includes(e))
              .slice(0, 12)
              .map((ext) => (
                <button
                  key={ext}
                  type="button"
                  onClick={() => setExtensions((prev) => [...prev, ext])}
                  className="px-1.5 py-0.5 text-xs text-muted-foreground hover:text-foreground hover:bg-muted rounded transition-colors"
                >
                  .{ext}
                </button>
              ))}
          </div>
        </div>

        {/* Tags */}
        <div>
          <label className="block text-sm font-medium mb-2">Tags</label>
          <TagPicker selectedTagIds={tagIds} onChange={setTagIds} placeholder="Add tag..." />
        </div>

        {/* File Size */}
        <div>
          <label className="block text-sm font-medium mb-2">File Size</label>
          <div className="flex flex-wrap gap-2">
            {SIZE_PRESETS.map((preset, i) => {
              const isSelected = sizeMin === preset.min && sizeMax === preset.max;
              return (
                <button
                  key={i}
                  type="button"
                  onClick={() => handleSizePreset(preset.min, preset.max)}
                  className={cn(
                    "px-3 py-1.5 text-sm rounded-md border transition-colors",
                    isSelected
                      ? "bg-primary text-primary-foreground border-primary"
                      : "bg-background border-input hover:border-primary/50",
                  )}
                >
                  {preset.label}
                </button>
              );
            })}
            {(sizeMin !== undefined || sizeMax !== undefined) && (
              <button
                type="button"
                onClick={handleClearSize}
                className="px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
              >
                Clear
              </button>
            )}
          </div>
        </div>

        {/* Sort Options */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium mb-1.5">Sort By</label>
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value)}
              className="w-full px-3 py-2 bg-background border border-input rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-ring"
            >
              {SORT_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1.5">Sort Order</label>
            <select
              value={sortOrder}
              onChange={(e) => setSortOrder(e.target.value)}
              className="w-full px-3 py-2 bg-background border border-input rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-ring"
            >
              <option value="desc">Descending</option>
              <option value="asc">Ascending</option>
            </select>
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="flex justify-end gap-3 px-6 py-4 border-t border-border bg-muted/20">
        <Button variant="outline" size="md" onClick={onCancel} disabled={saving}>
          Cancel
        </Button>
        <Button variant="default" size="md" onClick={handleSave} disabled={saving}>
          {saving ? "Saving..." : initialFilter ? "Update Filter" : "Create Filter"}
        </Button>
      </div>
    </div>
  );
}
