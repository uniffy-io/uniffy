import { useCallback, useEffect, useMemo } from 'react';
import { useAppSelector } from '@/app/hooks';

/** Fallback used until user settings load; diff against this drives the rebind UI in KeyboardShortcutsSection. */
const DEFAULT_SHORTCUTS: Record<string, string> = {
    'nav.search': 'Ctrl+K',
    'app.settings': 'Ctrl+,',
    'app.commandPalette': 'Ctrl+Shift+P',
    'app.help': 'F1',
    'app.zenMode': 'Ctrl+\\',
    'app.toggleSidebar': 'Ctrl+B',
    'viewer.close': 'Escape',
    'viewer.next': 'ArrowRight',
    'viewer.previous': 'ArrowLeft',
    'viewer.togglePlay': 'Space',
    'viewer.fullscreen': 'F',
    'viewer.zoomIn': '=',
    'viewer.zoomOut': '-',
    'viewer.zoomReset': '0',
    'viewer.rotateRight': 'R',
    'viewer.download': 'Ctrl+S',
    'viewer.edit': 'E',
    'comments.toggle': 'Ctrl+Shift+M',
    'comments.new': 'Ctrl+Shift+C',
    'imageEditor.undo': 'Ctrl+Z',
    'imageEditor.redo': 'Ctrl+Shift+Z',
    'imageEditor.save': 'Ctrl+S',
    'imageEditor.cancel': 'Escape',
    'imageEditor.rotateRight': 'R',
    'imageEditor.rotateLeft': 'Shift+R',
    'imageEditor.flipH': 'H',
    'imageEditor.flipV': 'V',
    'imageEditor.crop': 'C',
    'imageEditor.applyCrop': 'Enter',
    'projects.focusUp': 'ArrowUp',
    'projects.focusDown': 'ArrowDown',
    'projects.focusLeft': 'ArrowLeft',
    'projects.focusRight': 'ArrowRight',
    'projects.editCell': 'Enter',
    'projects.cancelEdit': 'Escape',
    'projects.toggleSelect': 'Space',
    'projects.undo': 'Ctrl+Z',
    'projects.redo': 'Ctrl+Shift+Z',
    'recording.toggleQuickClip': 'Ctrl+Alt+S',
    // Tooltip-only; Milkdown owns the actual keymap.
    'editor.undo': 'Ctrl+Z',
    'editor.redo': 'Ctrl+Shift+Z',
    'chat.editLast': 'ArrowUp',
    'canvas.addText': 'T',
    'canvas.addShape': 'S',
    'canvas.deleteSelected': 'Delete',
    'canvas.selectAll': 'Ctrl+A',
    'canvas.fitView': 'Ctrl+Shift+1',
    'canvas.zoomIn': 'Ctrl+=',
    'canvas.zoomOut': 'Ctrl+-',
    'canvas.undo': 'Ctrl+Z',
    'canvas.redo': 'Ctrl+Shift+Z',
};

const isMac = typeof window !== 'undefined' && navigator.platform.toUpperCase().indexOf('MAC') >= 0;

function parseShortcut(shortcut: string) {
    const parts = shortcut.toLowerCase().split('+');
    const key = parts[parts.length - 1];

    // On Mac the "Ctrl" token in a binding maps to Cmd/Meta.
    const usesMeta = isMac && parts.some(p => p === 'ctrl' || p === 'cmd' || p === 'meta');
    const usesCtrl = !isMac && parts.some(p => p === 'ctrl');

    return {
        ctrl: usesCtrl || parts.includes('ctrl'),
        shift: parts.includes('shift'),
        alt: parts.includes('alt') || parts.includes('option'),
        meta: usesMeta || parts.includes('meta') || parts.includes('cmd'),
        key: key,
    };
}

export function formatShortcut(shortcut: string): string {
    if (isMac) {
        return shortcut
            .replace(/Ctrl\+/g, '⌘')
            .replace(/Alt\+/g, '⌥')
            .replace(/Shift\+/g, '⇧')
            .replace(/Meta\+/g, '⌘');
    }
    return shortcut;
}

/** Exported so callers with their own keydown listener (focused contentEditable surfaces) can honour the user's bound key. */
export function matchesShortcut(event: KeyboardEvent, shortcut: string): boolean {
    const parsed = parseShortcut(shortcut);

    const ctrlMatch = isMac
        ? event.metaKey === parsed.meta
        : event.ctrlKey === parsed.ctrl;

    if (!ctrlMatch) return false;
    if (event.shiftKey !== parsed.shift) return false;
    if (event.altKey !== parsed.alt) return false;

    const eventKey = event.key.toLowerCase();
    if (parsed.key === 'left') return eventKey === 'arrowleft';
    if (parsed.key === 'right') return eventKey === 'arrowright';
    if (parsed.key === '\\') return eventKey === '\\' || event.code === 'Backslash';
    if (parsed.key === ',') return eventKey === ',';

    return eventKey === parsed.key;
}

/** Modifier chords (Ctrl/Cmd/Alt) override focused editors; bare keys and Shift-only chords defer to typing. */
function shortcutOwnsKeypress(shortcut: string): boolean {
    const parsed = parseShortcut(shortcut);
    return parsed.ctrl || parsed.meta || parsed.alt;
}

function isEditableTarget(target: EventTarget | null): boolean {
    const el = target as HTMLElement | null;
    if (!el) return false;
    return (
        el.tagName === 'INPUT' ||
        el.tagName === 'TEXTAREA' ||
        el.isContentEditable
    );
}

export function useKeyboardBindings() {
    const effectiveSettings = useAppSelector(state => state.settings.effectiveSettings);

    return useMemo(() => {
        const userBindings = effectiveSettings?.keyboardShortcuts?.bindings ?? {};
        return {
            ...DEFAULT_SHORTCUTS,
            ...userBindings,
        };
    }, [effectiveSettings?.keyboardShortcuts?.bindings]);
}

export function useKeybinding(action: string): string {
    const bindings = useKeyboardBindings();
    return bindings[action] ?? '';
}

export function useFormattedKeybinding(action: string): string {
    const shortcut = useKeybinding(action);
    return formatShortcut(shortcut);
}

export function useShortcutHandler(
    action: string,
    handler: () => void,
    options: {
        enabled?: boolean;
        preventDefault?: boolean;
    } = {}
) {
    const { enabled = true, preventDefault = true } = options;
    const shortcut = useKeybinding(action);

    useEffect(() => {
        if (!enabled || !shortcut) return;

        const handleKeyDown = (event: KeyboardEvent) => {
            // Bare/Shift-only chords defer to focused editors; modifier chords always fire.
            if (isEditableTarget(event.target) && !shortcutOwnsKeypress(shortcut)) {
                return;
            }

            if (matchesShortcut(event, shortcut)) {
                if (preventDefault) {
                    event.preventDefault();
                }
                handler();
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [shortcut, handler, enabled, preventDefault]);
}

export function useShortcutHandlers(
    handlers: Record<string, () => void>,
    options: {
        enabled?: boolean;
        preventDefault?: boolean;
    } = {}
) {
    const { enabled = true, preventDefault = true } = options;
    const bindings = useKeyboardBindings();

    useEffect(() => {
        if (!enabled) return;

        const handleKeyDown = (event: KeyboardEvent) => {
            const editable = isEditableTarget(event.target);

            for (const [action, handler] of Object.entries(handlers)) {
                const shortcut = bindings[action];
                if (!shortcut) continue;
                if (editable && !shortcutOwnsKeypress(shortcut)) continue;
                if (matchesShortcut(event, shortcut)) {
                    if (preventDefault) {
                        event.preventDefault();
                    }
                    handler();
                    break;
                }
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [bindings, handlers, enabled, preventDefault]);
}

export function useGlobalShortcuts() {
    const bindings = useKeyboardBindings();

    const matches = useCallback((action: string, event: KeyboardEvent): boolean => {
        const shortcut = bindings[action];
        return shortcut ? matchesShortcut(event, shortcut) : false;
    }, [bindings]);

    return { bindings, matches, formatShortcut };
}
