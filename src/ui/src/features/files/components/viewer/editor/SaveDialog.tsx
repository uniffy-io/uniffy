import { useState, useCallback } from "react";
import { FloppyDisk, File, Files, Warning } from "@phosphor-icons/react";
import { cn } from "@/shared/utils/cn";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal, ModalBody, ModalFooter, ModalHeader } from "@/components/ui/modal";

export type SaveMode = "new" | "version";
export type ImageFormat = "image/png" | "image/jpeg";

interface SaveDialogProps {
  /** Whether dialog is open */
  isOpen: boolean;
  /** Close dialog callback */
  onClose: () => void;
  /** Save as new file callback */
  onSaveAsNew: (filename: string, format: ImageFormat, quality: number) => Promise<boolean>;
  /** Save as new version callback */
  onSaveAsVersion: (format: ImageFormat, quality: number) => Promise<boolean>;
  /** Original filename for default suggestion */
  originalFilename: string;
  /** Original MIME type */
  originalMimeType: string;
  /** Whether save is in progress */
  isSaving: boolean;
  /** Error message if save failed */
  error: string | null;
}

export function SaveDialog({
  isOpen,
  onClose,
  onSaveAsNew,
  onSaveAsVersion,
  originalFilename,
  originalMimeType,
  isSaving,
  error,
}: SaveDialogProps) {
  // Extract base filename without extension
  const baseName = originalFilename.replace(/\.[^/.]+$/, "");

  // Determine default format based on original
  const defaultFormat: ImageFormat = originalMimeType === "image/jpeg" ? "image/jpeg" : "image/png";

  const [saveMode, setSaveMode] = useState<SaveMode>("new");
  const [filename, setFilename] = useState(`${baseName}_edited`);
  const [format, setFormat] = useState<ImageFormat>(defaultFormat);
  const [quality, setQuality] = useState(92);

  const handleSave = useCallback(async () => {
    if (saveMode === "new") {
      await onSaveAsNew(filename, format, quality / 100);
    } else {
      await onSaveAsVersion(format, quality / 100);
    }
  }, [saveMode, filename, format, quality, onSaveAsNew, onSaveAsVersion]);

  const extension = format === "image/png" ? "png" : "jpg";

  if (!isOpen) return null;

  return (
    <Modal onClose={onClose} closeDisabled={isSaving} maxWidth="max-w-md">
      <ModalHeader title="Save image" />

      <ModalBody>
        <div>
          <label className="block text-sm text-muted-foreground mb-1">Save as</label>
          <div className="grid grid-cols-2 gap-2">
            <SaveModeOption
              mode="new"
              selected={saveMode === "new"}
              onSelect={setSaveMode}
              icon={<File size={20} />}
              label="New file"
              description="Create a new file"
              disabled={isSaving}
            />
            <SaveModeOption
              mode="version"
              selected={saveMode === "version"}
              onSelect={setSaveMode}
              icon={<Files size={20} />}
              label="New version"
              description="Replace current file"
              disabled={isSaving}
            />
          </div>
        </div>

        {saveMode === "new" && (
          <div>
            <label htmlFor="filename" className="block text-sm text-muted-foreground mb-1">
              Filename
            </label>
            <div className="flex items-center gap-2">
              <Input
                id="filename"
                type="text"
                value={filename}
                onChange={(e) => setFilename(e.target.value)}
                disabled={isSaving}
                placeholder="Enter filename"
              />
              <span className="text-sm text-muted-foreground">.{extension}</span>
            </div>
          </div>
        )}

        <div>
          <label className="block text-sm text-muted-foreground mb-1">Format</label>
          <div className="flex items-center gap-2">
            <FormatOption
              format="image/png"
              selected={format === "image/png"}
              onSelect={setFormat}
              label="PNG"
              description="Lossless, preserves transparency"
              disabled={isSaving}
            />
            <FormatOption
              format="image/jpeg"
              selected={format === "image/jpeg"}
              onSelect={setFormat}
              label="JPEG"
              description="Smaller size, no transparency"
              disabled={isSaving}
            />
          </div>
        </div>

        {format === "image/jpeg" && (
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-sm text-muted-foreground">Quality</label>
              <span className="text-sm text-muted-foreground">{quality}%</span>
            </div>
            <input
              type="range"
              min={10}
              max={100}
              value={quality}
              onChange={(e) => setQuality(Number(e.target.value))}
              disabled={isSaving}
              className={cn(
                "w-full h-2 rounded-full appearance-none cursor-pointer",
                "bg-muted accent-primary",
                "disabled:opacity-50 disabled:cursor-not-allowed",
              )}
            />
            <p className="text-xs text-muted-foreground mt-1">
              Higher quality means a larger file.
            </p>
          </div>
        )}

        {error && (
          <div className="flex items-start gap-2 p-3 rounded-md border status-error">
            <Warning
              size={18}
              className="shrink-0 mt-0.5"
              style={{ color: "var(--status-error)" }}
            />
            <p className="text-sm" style={{ color: "var(--status-error)" }}>
              {error}
            </p>
          </div>
        )}
      </ModalBody>

      <ModalFooter>
        <Button variant="ghost" onClick={onClose} disabled={isSaving}>
          Cancel
        </Button>
        <Button
          onClick={handleSave}
          loading={isSaving}
          disabled={isSaving || (saveMode === "new" && !filename.trim())}
        >
          <FloppyDisk size={16} />
          {isSaving ? "Saving..." : "Save"}
        </Button>
      </ModalFooter>
    </Modal>
  );
}

interface SaveModeOptionProps {
  mode: SaveMode;
  selected: boolean;
  onSelect: (mode: SaveMode) => void;
  icon: React.ReactNode;
  label: string;
  description: string;
  disabled?: boolean;
}

function SaveModeOption({
  mode,
  selected,
  onSelect,
  icon,
  label,
  description,
  disabled,
}: SaveModeOptionProps) {
  return (
    <button
      onClick={() => onSelect(mode)}
      disabled={disabled}
      className={cn(
        "flex flex-col items-center gap-1 p-3 rounded-lg border transition-colors",
        selected
          ? "border-primary bg-primary/10 text-primary"
          : "border-border bg-card hover:border-border-strong",
        "disabled:opacity-50 disabled:cursor-not-allowed",
      )}
    >
      {icon}
      <span className="text-sm font-medium">{label}</span>
      <span className="text-xs text-muted-foreground">{description}</span>
    </button>
  );
}

interface FormatOptionProps {
  format: ImageFormat;
  selected: boolean;
  onSelect: (format: ImageFormat) => void;
  label: string;
  description: string;
  disabled?: boolean;
}

function FormatOption({
  format,
  selected,
  onSelect,
  label,
  description,
  disabled,
}: FormatOptionProps) {
  return (
    <button
      onClick={() => onSelect(format)}
      disabled={disabled}
      className={cn(
        "flex-1 flex flex-col items-start p-3 rounded-lg border transition-colors text-left",
        selected
          ? "border-primary bg-primary/10"
          : "border-border bg-card hover:border-border-strong",
        "disabled:opacity-50 disabled:cursor-not-allowed",
      )}
    >
      <span className={cn("text-sm font-medium", selected && "text-primary")}>{label}</span>
      <span className="text-xs text-muted-foreground">{description}</span>
    </button>
  );
}
