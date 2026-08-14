import { useCallback, useState } from "react";
import { Dialog, DialogBackdrop, DialogPanel, DialogTitle } from "@headlessui/react";
import { X, FloppyDisk, File, Files, Warning } from "@phosphor-icons/react";
import { cn } from "@/shared/utils/cn";
import { Button } from "@/components/ui/button";

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

  return (
    <Dialog open={isOpen} onClose={onClose} className="relative z-50">
      <DialogBackdrop
        transition
        className="fixed inset-0 bg-black/60 backdrop-blur-sm transition-opacity data-[closed]:opacity-0"
      />

      <div className="fixed inset-0 flex items-center justify-center p-4">
        <DialogPanel
          transition
          className="w-full max-w-md bg-card text-card-foreground rounded-xl shadow-2xl border border-border transition-all data-[closed]:scale-95 data-[closed]:opacity-0"
        >
          <div className="flex items-center justify-between px-5 py-4 border-b border-border">
            <DialogTitle className="text-lg font-semibold flex items-center gap-2">
              <FloppyDisk size={20} />
              {isExtract
                ? "Extract Pages"
                : intent === "stamp"
                  ? "Save Watermarked PDF"
                  : "Save PDF"}
            </DialogTitle>
            <button
              onClick={onClose}
              disabled={isSaving}
              className="p-1 rounded-md hover:bg-muted transition-colors disabled:opacity-50"
            >
              <X size={20} />
            </button>
          </div>

          <div className="px-5 py-4 space-y-5">
            {!isExtract && (
              <div className="space-y-2">
                <label className="text-sm font-medium text-muted-foreground">Save As</label>
                <div className="grid grid-cols-2 gap-2">
                  <SaveModeOption
                    mode="new"
                    selected={saveMode === "new"}
                    onSelect={setSaveMode}
                    icon={<File size={20} />}
                    label="New File"
                    description="Create a new file"
                    disabled={isSaving}
                  />
                  <SaveModeOption
                    mode="version"
                    selected={saveMode === "version"}
                    onSelect={setSaveMode}
                    icon={<Files size={20} />}
                    label="New Version"
                    description="Replace current file"
                    disabled={isSaving}
                  />
                </div>
              </div>
            )}

            {showFilename && (
              <div className="space-y-2">
                <label htmlFor="pdf-filename" className="text-sm font-medium text-muted-foreground">
                  Filename
                </label>
                <div className="flex items-center gap-2">
                  <input
                    id="pdf-filename"
                    type="text"
                    value={filename}
                    onChange={(event) => setFilename(event.target.value)}
                    disabled={isSaving}
                    className={cn(
                      "flex-1 px-3 py-2 rounded-md border border-border bg-input",
                      "text-foreground placeholder:text-muted-foreground",
                      "focus:outline-none focus:ring-2 focus:ring-ring",
                      "disabled:opacity-50 disabled:cursor-not-allowed",
                    )}
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
          </div>

          <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-border">
            <Button variant="secondary" size="md" onClick={onClose} disabled={isSaving}>
              Cancel
            </Button>
            <Button
              size="md"
              onClick={handleSave}
              loading={isSaving}
              disabled={isSaving || (showFilename && !filename.trim())}
            >
              <FloppyDisk size={16} />
              {isSaving ? "Saving..." : isExtract ? "Extract" : "Save"}
            </Button>
          </div>
        </DialogPanel>
      </div>
    </Dialog>
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
          : "border-border bg-background hover:border-muted-foreground/30",
        "disabled:opacity-50 disabled:cursor-not-allowed",
      )}
    >
      {icon}
      <span className="text-sm font-medium">{label}</span>
      <span className="text-xs text-muted-foreground">{description}</span>
    </button>
  );
}
