/**
 * Keyboard shortcuts settings section.
 */

import React, { useState } from 'react';
import { useKeyboardBindings, formatShortcut } from '@/features/settings/hooks/useKeyboardShortcuts';
import { useSettings } from '@/features/settings/hooks/useSettings';

// Group shortcuts by category
const SHORTCUT_CATEGORIES = [
    {
        id: 'navigation',
        label: 'Navigation',
        shortcuts: [
            { action: 'nav.search', label: 'Search' },
        ],
    },
    {
        id: 'app',
        label: 'Application',
        shortcuts: [
            { action: 'app.settings', label: 'Open Settings' },
            { action: 'app.commandPalette', label: 'Command Palette' },
            { action: 'app.help', label: 'Help' },
            { action: 'app.zenMode', label: 'Zen Mode' },
            { action: 'app.toggleSidebar', label: 'Toggle Sidebar' },
        ],
    },
    {
        id: 'comments',
        label: 'Comments',
        shortcuts: [
            { action: 'comments.toggle', label: 'Toggle Comments Panel' },
            { action: 'comments.new', label: 'New Comment' },
        ],
    },
    {
        id: 'viewer',
        label: 'File Viewer',
        shortcuts: [
            { action: 'viewer.close', label: 'Close Viewer' },
            { action: 'viewer.next', label: 'Next File' },
            { action: 'viewer.previous', label: 'Previous File' },
            { action: 'viewer.togglePlay', label: 'Play/Pause' },
            { action: 'viewer.fullscreen', label: 'Toggle Fullscreen' },
            { action: 'viewer.zoomIn', label: 'Zoom In' },
            { action: 'viewer.zoomOut', label: 'Zoom Out' },
            { action: 'viewer.zoomReset', label: 'Reset Zoom' },
            { action: 'viewer.rotateRight', label: 'Rotate Right' },
            { action: 'viewer.download', label: 'Download File' },
            { action: 'viewer.edit', label: 'Edit Image' },
        ],
    },
    {
        id: 'imageEditor',
        label: 'Image Editor',
        shortcuts: [
            { action: 'imageEditor.undo', label: 'Undo' },
            { action: 'imageEditor.redo', label: 'Redo' },
            { action: 'imageEditor.save', label: 'Save' },
            { action: 'imageEditor.cancel', label: 'Cancel / Exit' },
            { action: 'imageEditor.rotateRight', label: 'Rotate Right' },
            { action: 'imageEditor.rotateLeft', label: 'Rotate Left' },
            { action: 'imageEditor.flipH', label: 'Flip Horizontal' },
            { action: 'imageEditor.flipV', label: 'Flip Vertical' },
            { action: 'imageEditor.crop', label: 'Crop Tool' },
            { action: 'imageEditor.applyCrop', label: 'Apply Crop' },
        ],
    },
    {
        id: 'canvas',
        label: 'Canvas',
        shortcuts: [
            { action: 'canvas.addText', label: 'Add Text Block' },
            { action: 'canvas.addShape', label: 'Add Shape' },
            { action: 'canvas.deleteSelected', label: 'Delete Selected' },
            { action: 'canvas.selectAll', label: 'Select All' },
            { action: 'canvas.fitView', label: 'Fit to View' },
            { action: 'canvas.zoomIn', label: 'Zoom In' },
            { action: 'canvas.zoomOut', label: 'Zoom Out' },
            { action: 'canvas.undo', label: 'Undo' },
            { action: 'canvas.redo', label: 'Redo' },
        ],
    },
];

// Helper to find action label from categories
const getActionLabel = (action: string): string => {
    for (const category of SHORTCUT_CATEGORIES) {
        const shortcut = category.shortcuts.find(s => s.action === action);
        if (shortcut) return shortcut.label;
    }
    return action;
};

// Normalize binding for comparison (handle Ctrl/Cmd equivalence)
const normalizeBinding = (binding: string): string => {
    return binding.toLowerCase().replace(/cmd/g, 'ctrl');
};

interface ConflictInfo {
    action: string;
    label: string;
}

interface ShortcutEditorProps {
    action: string;
    label: string;
    currentBinding: string;
    allBindings: Record<string, string>;
    onUpdate: (action: string, binding: string, conflictingAction?: string) => void;
    onReset: (action: string) => void;
}

function ShortcutEditor({ action, label, currentBinding, allBindings, onUpdate, onReset }: ShortcutEditorProps) {
    const [isEditing, setIsEditing] = useState(false);
    const [tempBinding, setTempBinding] = useState('');
    const [conflict, setConflict] = useState<ConflictInfo | null>(null);

    // Check for conflicts when temp binding changes
    const checkConflict = (binding: string): ConflictInfo | null => {
        const normalizedNew = normalizeBinding(binding);

        for (const [otherAction, otherBinding] of Object.entries(allBindings)) {
            if (otherAction === action) continue; // Skip self
            if (!otherBinding) continue;

            if (normalizeBinding(otherBinding) === normalizedNew) {
                return {
                    action: otherAction,
                    label: getActionLabel(otherAction),
                };
            }
        }
        return null;
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        e.preventDefault();

        // Build the shortcut string
        const parts: string[] = [];
        if (e.ctrlKey || e.metaKey) parts.push('Ctrl');
        if (e.shiftKey) parts.push('Shift');
        if (e.altKey) parts.push('Alt');

        // Get the key
        let key = e.key;
        if (key === ' ') key = 'Space';
        else if (key.length === 1) key = key.toUpperCase();
        else if (key.startsWith('Arrow')) key = key.replace('Arrow', '');

        // Ignore modifier-only presses
        if (['Control', 'Shift', 'Alt', 'Meta'].includes(key)) return;

        parts.push(key);
        const binding = parts.join('+');
        setTempBinding(binding);
        setConflict(checkConflict(binding));
    };

    const handleSave = () => {
        if (tempBinding) {
            onUpdate(action, tempBinding, conflict?.action);
        }
        setIsEditing(false);
        setTempBinding('');
        setConflict(null);
    };

    const handleCancel = () => {
        setIsEditing(false);
        setTempBinding('');
        setConflict(null);
    };

    if (isEditing) {
        return (
            <div className={`py-3 px-4 rounded-lg border ${conflict ? 'bg-yellow-50 dark:bg-yellow-900/20 border-yellow-500' : 'bg-primary/5 border-primary'}`}>
                <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-foreground">{label}</span>
                    <div className="flex items-center gap-2">
                        <input
                            type="text"
                            className={`w-32 px-2 py-1 text-sm bg-background border rounded text-center font-mono ${
                                conflict ? 'border-yellow-500' : 'border-border'
                            }`}
                            value={tempBinding || 'Press keys...'}
                            readOnly
                            onKeyDown={handleKeyDown}
                            autoFocus
                        />
                        <button
                            type="button"
                            className={`px-2 py-1 text-xs rounded ${
                                conflict
                                    ? 'bg-yellow-500 text-white hover:bg-yellow-600'
                                    : 'bg-primary text-primary-foreground'
                            }`}
                            onClick={handleSave}
                            disabled={!tempBinding}
                        >
                            {conflict ? 'Overwrite' : 'Save'}
                        </button>
                        <button
                            type="button"
                            className="px-2 py-1 text-xs bg-muted text-muted-foreground rounded"
                            onClick={handleCancel}
                        >
                            Cancel
                        </button>
                    </div>
                </div>
                {conflict && (
                    <div className="mt-2 text-sm text-yellow-700 dark:text-yellow-400">
                        This shortcut is already used by "{conflict.label}". Saving will remove it from that action.
                    </div>
                )}
            </div>
        );
    }

    return (
        <div className="flex items-center justify-between py-3 px-4 rounded-lg hover:bg-muted/50 transition-colors group">
            <span className="text-sm font-medium text-foreground">{label}</span>
            <div className="flex items-center gap-2">
                <button
                    type="button"
                    className="px-3 py-1 text-sm font-mono bg-muted rounded text-foreground hover:bg-muted/80 transition-colors"
                    onClick={() => setIsEditing(true)}
                >
                    {formatShortcut(currentBinding)}
                </button>
                <button
                    type="button"
                    className="px-2 py-1 text-xs text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity"
                    onClick={() => onReset(action)}
                >
                    Reset
                </button>
            </div>
        </div>
    );
}

export function KeyboardShortcutsSection() {
    const bindings = useKeyboardBindings();
    const { updateSettings } = useSettings();

    const handleUpdate = (action: string, binding: string, conflictingAction?: string) => {
        // If there's a conflict, remove the binding from the conflicting action
        const bindingsUpdate: Record<string, string | undefined> = { [action]: binding };
        if (conflictingAction) {
            bindingsUpdate[conflictingAction] = undefined;
        }

        updateSettings({
            keyboardShortcuts: {
                bindings: bindingsUpdate as Record<string, string>,
            },
        });
    };

    const handleReset = (action: string) => {
        // Reset by setting to undefined (will use default)
        updateSettings({
            keyboardShortcuts: {
                bindings: { [action]: undefined as unknown as string },
            },
        });
    };

    return (
        <div className="space-y-8">
            <div>
                <h1 className="text-2xl font-bold text-foreground mb-2">Keyboard Shortcuts</h1>
                <p className="text-muted-foreground">
                    Customize keyboard shortcuts for common actions.
                </p>
            </div>

            {SHORTCUT_CATEGORIES.map(({ id, label, shortcuts }) => (
                <section key={id} className="space-y-2">
                    <h2 className="text-lg font-semibold text-foreground mb-4">{label}</h2>
                    <div className="space-y-1 bg-card rounded-lg border border-border">
                        {shortcuts.map(({ action, label: shortcutLabel }) => (
                            <ShortcutEditor
                                key={action}
                                action={action}
                                label={shortcutLabel}
                                currentBinding={bindings[action] || ''}
                                allBindings={bindings}
                                onUpdate={handleUpdate}
                                onReset={handleReset}
                            />
                        ))}
                    </div>
                </section>
            ))}

            <div className="text-sm text-muted-foreground">
                <p>Click on a shortcut to edit it. Press the new key combination and click Save.</p>
            </div>
        </div>
    );
}

