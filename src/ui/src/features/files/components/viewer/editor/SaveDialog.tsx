/**
 * Save Dialog Component
 *
 * Dialog for saving edited images with options for:
 * - Save as new file (with custom filename)
 * - Save as new version (replace current file)
 * - Format selection (PNG/JPEG)
 * - Quality slider (for JPEG)
 */

import { useState, useCallback } from 'react';
import { Dialog, DialogBackdrop, DialogPanel, DialogTitle } from '@headlessui/react';
import { X, FloppyDisk, File, Files, Warning } from '@phosphor-icons/react';
import { cn } from '@/shared/utils/cn';
import { Button } from '@/components/ui/button';

export type SaveMode = 'new' | 'version';
export type ImageFormat = 'image/png' | 'image/jpeg';

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
    const baseName = originalFilename.replace(/\.[^/.]+$/, '');

    // Determine default format based on original
    const defaultFormat: ImageFormat = originalMimeType === 'image/jpeg' ? 'image/jpeg' : 'image/png';

    const [saveMode, setSaveMode] = useState<SaveMode>('new');
    const [filename, setFilename] = useState(`${baseName}_edited`);
    const [format, setFormat] = useState<ImageFormat>(defaultFormat);
    const [quality, setQuality] = useState(92);

    // Handle save
    const handleSave = useCallback(async () => {
        if (saveMode === 'new') {
            await onSaveAsNew(filename, format, quality / 100);
        } else {
            await onSaveAsVersion(format, quality / 100);
        }
    }, [saveMode, filename, format, quality, onSaveAsNew, onSaveAsVersion]);

    // Get extension for format
    const extension = format === 'image/png' ? 'png' : 'jpg';

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
                    {/* Header */}
                    <div className="flex items-center justify-between px-5 py-4 border-b border-border">
                        <DialogTitle className="text-lg font-semibold flex items-center gap-2">
                            <FloppyDisk size={20} />
                            Save Image
                        </DialogTitle>
                        <button
                            onClick={onClose}
                            disabled={isSaving}
                            className="p-1 rounded-md hover:bg-muted transition-colors disabled:opacity-50"
                        >
                            <X size={20} />
                        </button>
                    </div>

                    {/* Content */}
                    <div className="px-5 py-4 space-y-5">
                        {/* Save mode selection */}
                        <div className="space-y-2">
                            <label className="text-sm font-medium text-muted-foreground">
                                Save As
                            </label>
                            <div className="grid grid-cols-2 gap-2">
                                <SaveModeOption
                                    mode="new"
                                    selected={saveMode === 'new'}
                                    onSelect={setSaveMode}
                                    icon={<File size={20} />}
                                    label="New File"
                                    description="Create a new file"
                                    disabled={isSaving}
                                />
                                <SaveModeOption
                                    mode="version"
                                    selected={saveMode === 'version'}
                                    onSelect={setSaveMode}
                                    icon={<Files size={20} />}
                                    label="New Version"
                                    description="Replace current file"
                                    disabled={isSaving}
                                />
                            </div>
                        </div>

                        {/* Filename (only for new file) */}
                        {saveMode === 'new' && (
                            <div className="space-y-2">
                                <label
                                    htmlFor="filename"
                                    className="text-sm font-medium text-muted-foreground"
                                >
                                    Filename
                                </label>
                                <div className="flex items-center gap-2">
                                    <input
                                        id="filename"
                                        type="text"
                                        value={filename}
                                        onChange={(e) => setFilename(e.target.value)}
                                        disabled={isSaving}
                                        className={cn(
                                            'flex-1 px-3 py-2 rounded-md border border-border bg-input',
                                            'text-foreground placeholder:text-muted-foreground',
                                            'focus:outline-none focus:ring-2 focus:ring-ring',
                                            'disabled:opacity-50 disabled:cursor-not-allowed'
                                        )}
                                        placeholder="Enter filename"
                                    />
                                    <span className="text-sm text-muted-foreground">.{extension}</span>
                                </div>
                            </div>
                        )}

                        {/* Format selection */}
                        <div className="space-y-2">
                            <label className="text-sm font-medium text-muted-foreground">
                                Format
                            </label>
                            <div className="flex items-center gap-2">
                                <FormatOption
                                    format="image/png"
                                    selected={format === 'image/png'}
                                    onSelect={setFormat}
                                    label="PNG"
                                    description="Lossless, preserves transparency"
                                    disabled={isSaving}
                                />
                                <FormatOption
                                    format="image/jpeg"
                                    selected={format === 'image/jpeg'}
                                    onSelect={setFormat}
                                    label="JPEG"
                                    description="Smaller size, no transparency"
                                    disabled={isSaving}
                                />
                            </div>
                        </div>

                        {/* Quality slider (only for JPEG) */}
                        {format === 'image/jpeg' && (
                            <div className="space-y-2">
                                <div className="flex items-center justify-between">
                                    <label className="text-sm font-medium text-muted-foreground">
                                        Quality
                                    </label>
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
                                        'w-full h-2 rounded-full appearance-none cursor-pointer',
                                        'bg-muted accent-primary',
                                        'disabled:opacity-50 disabled:cursor-not-allowed'
                                    )}
                                />
                                <p className="text-xs text-muted-foreground">
                                    Higher quality means larger file size
                                </p>
                            </div>
                        )}

                        {/* Error message */}
                        {error && (
                            <div className="flex items-start gap-2 p-3 rounded-md border status-error">
                                <Warning size={18} className="shrink-0 mt-0.5" style={{ color: 'var(--status-error)' }} />
                                <p className="text-sm" style={{ color: 'var(--status-error)' }}>{error}</p>
                            </div>
                        )}
                    </div>

                    {/* Footer */}
                    <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-border">
                        <Button variant="secondary" size="md" onClick={onClose} disabled={isSaving}>
                            Cancel
                        </Button>
                        <Button
                            size="md"
                            onClick={handleSave}
                            loading={isSaving}
                            disabled={isSaving || (saveMode === 'new' && !filename.trim())}
                        >
                            <FloppyDisk size={16} />
                            {isSaving ? 'Saving...' : 'Save'}
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
                'flex flex-col items-center gap-1 p-3 rounded-lg border transition-colors',
                selected
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'border-border bg-background hover:border-muted-foreground/30',
                'disabled:opacity-50 disabled:cursor-not-allowed'
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
                'flex-1 flex flex-col items-start p-3 rounded-lg border transition-colors text-left',
                selected
                    ? 'border-primary bg-primary/10'
                    : 'border-border bg-background hover:border-muted-foreground/30',
                'disabled:opacity-50 disabled:cursor-not-allowed'
            )}
        >
            <span className={cn('text-sm font-medium', selected && 'text-primary')}>{label}</span>
            <span className="text-xs text-muted-foreground">{description}</span>
        </button>
    );
}
