/**
 * Keyboard shortcuts hooks for global keyboard handling.
 */

import { useCallback, useEffect, useMemo } from 'react';
import { useAppSelector } from '@/app/hooks';

/**
 * Default keyboard shortcuts (fallback when settings not loaded).
 */
const DEFAULT_SHORTCUTS: Record<string, string> = {
    // Navigation actions
    'nav.search': 'Ctrl+K',
    // App actions
    'app.settings': 'Ctrl+,',
    'app.commandPalette': 'Ctrl+Shift+P',
    'app.help': 'F1',
    'app.zenMode': 'Ctrl+\\',
    'app.toggleSidebar': 'Ctrl+B',
    // File viewer actions
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
    // Image editor actions
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
    // Projects table keyboard navigation
    'projects.focusUp': 'ArrowUp',
    'projects.focusDown': 'ArrowDown',
    'projects.focusLeft': 'ArrowLeft',
    'projects.focusRight': 'ArrowRight',
    'projects.editCell': 'Enter',
    'projects.cancelEdit': 'Escape',
    'projects.toggleSelect': 'Space',
    // Projects undo/redo
    'projects.undo': 'Ctrl+Z',
    'projects.redo': 'Ctrl+Shift+Z',
};

/**
 * Detect if running on macOS.
 */
const isMac = typeof window !== 'undefined' && navigator.platform.toUpperCase().indexOf('MAC') >= 0;

/**
 * Parse a shortcut string into parts.
 * e.g., "Ctrl+Shift+K" -> { ctrl: true, shift: true, alt: false, meta: false, key: 'k' }
 */
function parseShortcut(shortcut: string) {
    const parts = shortcut.toLowerCase().split('+');
    const key = parts[parts.length - 1];

    // On Mac, Ctrl is often Cmd
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

/**
 * Format a shortcut for display (platform-aware).
 * e.g., "Ctrl+K" -> "⌘K" on Mac, "Ctrl+K" on Windows
 */
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

/**
 * Check if a keyboard event matches a shortcut.
 */
function matchesShortcut(event: KeyboardEvent, shortcut: string): boolean {
    const parsed = parseShortcut(shortcut);

    // On Mac, Ctrl key in shortcut means Meta (Cmd)
    const ctrlMatch = isMac
        ? event.metaKey === parsed.meta
        : event.ctrlKey === parsed.ctrl;

    // Check modifiers
    if (!ctrlMatch) return false;
    if (event.shiftKey !== parsed.shift) return false;
    if (event.altKey !== parsed.alt) return false;

    // Check key
    const eventKey = event.key.toLowerCase();
    if (parsed.key === 'left') return eventKey === 'arrowleft';
    if (parsed.key === 'right') return eventKey === 'arrowright';
    if (parsed.key === '\\') return eventKey === '\\' || event.code === 'Backslash';
    if (parsed.key === ',') return eventKey === ',';

    return eventKey === parsed.key;
}

/**
 * Hook for accessing keyboard shortcut bindings from settings.
 */
export function useKeyboardBindings() {
    const effectiveSettings = useAppSelector(state => state.settings.effectiveSettings);

    return useMemo(() => {
        // Merge defaults with user overrides
        const userBindings = effectiveSettings?.keyboardShortcuts?.bindings ?? {};
        return {
            ...DEFAULT_SHORTCUTS,
            ...userBindings,
        };
    }, [effectiveSettings?.keyboardShortcuts?.bindings]);
}

/**
 * Get the shortcut for a specific action.
 * @param action - Action identifier (e.g., "editor.save", "nav.search")
 * @returns The keyboard shortcut string
 */
export function useKeybinding(action: string): string {
    const bindings = useKeyboardBindings();
    return bindings[action] ?? '';
}

/**
 * Get the formatted (display) shortcut for an action.
 * @param action - Action identifier
 * @returns Platform-formatted shortcut (e.g., "⌘K" on Mac)
 */
export function useFormattedKeybinding(action: string): string {
    const shortcut = useKeybinding(action);
    return formatShortcut(shortcut);
}

/**
 * Register a keyboard shortcut handler.
 *
 * @param action - Action identifier to listen for
 * @param handler - Callback function when shortcut is pressed
 * @param options - Options for the handler
 */
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
            // Don't trigger if user is typing in an input
            const target = event.target as HTMLElement;
            if (
                target.tagName === 'INPUT' ||
                target.tagName === 'TEXTAREA' ||
                target.isContentEditable
            ) {
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

/**
 * Register multiple keyboard shortcut handlers.
 *
 * @param handlers - Map of action identifiers to handler functions
 * @param options - Options for all handlers
 */
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
            // Don't trigger if user is typing in an input
            const target = event.target as HTMLElement;
            if (
                target.tagName === 'INPUT' ||
                target.tagName === 'TEXTAREA' ||
                target.isContentEditable
            ) {
                return;
            }

            // Check each registered handler
            for (const [action, handler] of Object.entries(handlers)) {
                const shortcut = bindings[action];
                if (shortcut && matchesShortcut(event, shortcut)) {
                    if (preventDefault) {
                        event.preventDefault();
                    }
                    handler();
                    break; // Only handle one action per keypress
                }
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [bindings, handlers, enabled, preventDefault]);
}

/**
 * Hook that returns a keyboard shortcut handler component.
 * Use this when you need to provide global shortcuts in a component.
 */
export function useGlobalShortcuts() {
    const bindings = useKeyboardBindings();

    /**
     * Check if a shortcut matches the given event.
     */
    const matches = useCallback((action: string, event: KeyboardEvent): boolean => {
        const shortcut = bindings[action];
        return shortcut ? matchesShortcut(event, shortcut) : false;
    }, [bindings]);

    return { bindings, matches, formatShortcut };
}
