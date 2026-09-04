import { useCallback, useState } from "react";
import { FloppyDisk, File, Files, Warning } from "@phosphor-icons/react";
import { cn } from "@/shared/utils/cn";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal, ModalBody, ModalFooter, ModalHeader } from "@/components/ui/modal";

type SaveMode = "new" | "version";

interface PdfSaveDialogProps {
  isOpen: boolean;
  /** `extract` locks the dialog to New File with a `{base}_pages` default. */
  intent: "edit" | "extract" | "stamp";
  originalFilename: string;
  isSaving: boolean;
  error: string | null;
  onClose: () => void;
  onSaveAsNew: (filename: string) => Promise<boolean>;
  onSaveAsVersion: () => Promise<boolean>;
}

export function PdfSaveDialog(props: PdfSaveDialogProps) {
  // Remount per open so the filename default tracks the current intent.
  return <PdfSaveDialogContent key={`${props.intent}-${props.isOpen}`} {...props} />;
}

function PdfSaveDialogContent({
  isOpen,
  intent,
  originalFilename,
  isSaving,
  error,
  onClose,
  onSaveAsNew,
  onSaveAsVersion,
}: PdfSaveDialogProps) {
  const baseName = originalFilename.replace(/\.[^/.]+$/, "");
  const isExtract = intent === "extract";
  const defaultSuffix = isExtract ? "_pages" : intent === "stamp" ? "_watermarked" : "_edited";

  const [saveMode, setSaveMode] = useState<SaveMode>("new");
  const [filename, setFilename] = useState(`${baseName}${defaultSuffix}`);

  const handleSave = useCallback(async () => {
    if (saveMode === "new" || isExtract) {
      await onSaveAsNew(filename);
    } else {
      await onSaveAsVersion();
    }
  }, [saveMode, isExtract, filename, onSaveAsNew, onSaveAsVersion]);

  const showFilename = saveMode === "new" || isExtract;

  if (!isOpen) return null;

  const title = isExtract
    ? "Extract pages"
    : intent === "stamp"
      ? "Save watermarked PDF"
      : "Save PDF";
  const description = isExtract
    ? "The selected pages are saved as a new file."
    : "Keep the result as a new file or replace the current one with a new version.";

  return (
    <Modal onClose={onClose} closeDisabled={isSaving} maxWidth="max-w-md">
      <ModalHeader title={title} description={description} />

      <ModalBody>
        {!isExtract && (
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
        )}

        {showFilename && (
          <div>
            <label htmlFor="pdf-filename" className="block text-sm text-muted-foreground mb-1">
              Filename
            </label>
            <div className="flex items-center gap-2">
              <Input
                id="pdf-filename"
                type="text"
                value={filename}
                onChange={(event) => setFilename(event.target.value)}
                disabled={isSaving}
                placeholder="Enter filename"
              />
              <span className="text-sm text-muted-foreground">.pdf</span>
            </div>
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
          disabled={isSaving || (showFilename && !filename.trim())}
        >
          <FloppyDisk size={16} />
          {isSaving ? "Saving..." : isExtract ? "Extract" : "Save"}
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
