/**
 * Notes Hooks
 *
 * Custom hooks for notes feature functionality.
 */

import { useCallback, useRef, useEffect, useMemo } from 'react';
import { useAppDispatch, useAppSelector } from '@/app/hooks';
import {
    autosaveNote,
    fetchNote,
} from '../store/notesSlice';
import { invalidateNotePreviewCache } from '../components/editor/plugins/mention/useUrnPreview';
import {
    setDraftContent,
    setAutosaveSaving,
    setAutosaveLastSaved,
    setAutosaveError,
    markSaved,
    markUnsaved,
} from '../store/editorSlice';

const AUTOSAVE_DELAY_MS = 2000; // 2 seconds debounce

/**
 * Fast string hash using djb2 algorithm.
 * Good enough for change detection, not cryptographic.
 */
function hashString(str: string): number {
    let hash = 5381;
    for (let i = 0; i < str.length; i++) {
        hash = ((hash << 5) + hash) ^ str.charCodeAt(i);
    }
    return hash >>> 0; // Convert to unsigned 32-bit
}

/**
 * Hook for managing autosave functionality.
 */
export function useAutosave(noteId: string | null) {
    const dispatch = useAppDispatch();
    const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const autosave = useAppSelector((state) => state.editor.autosave);
    const draftContent = useAppSelector((state) =>
        noteId ? state.editor.draftContent[noteId] : null
    );
    const hasUnsavedChanges = useAppSelector((state) =>
        noteId ? state.editor.hasUnsavedChanges[noteId] : false
    );
    // Get original note content and compute hash for efficient comparison
    const originalContent = useAppSelector((state) =>
        noteId ? state.notes.notes[noteId]?.content : null
    );
    const originalContentHash = useMemo(
        () => (originalContent != null ? hashString(originalContent) : null),
        [originalContent]
    );

    const isSaving = noteId ? autosave.isSaving[noteId] : false;
    const lastSaved = noteId ? autosave.lastSaved[noteId] : null;
    const error = noteId ? autosave.error[noteId] : null;

    // Perform the autosave
    const performAutosave = useCallback(
        async (content: string, title?: string) => {
            if (!noteId) return;

            dispatch(setAutosaveSaving({ noteId, isSaving: true }));
            dispatch(setAutosaveError({ noteId, error: null }));

            try {
                await dispatch(
                    autosaveNote({
                        noteId,
                        content,
                        title,
                    })
                ).unwrap();

                dispatch(setAutosaveLastSaved({ noteId, timestamp: Date.now() }));
                dispatch(markSaved(noteId));

                // Invalidate preview cache so hover previews show fresh content
                invalidateNotePreviewCache(noteId);
            } catch (err) {
                dispatch(
                    setAutosaveError({
                        noteId,
                        error: err instanceof Error ? err.message : 'Autosave failed',
                    })
                );
            } finally {
                dispatch(setAutosaveSaving({ noteId, isSaving: false }));
            }
        },
        [dispatch, noteId]
    );

    // Schedule an autosave (debounced)
    const scheduleAutosave = useCallback(
        (content: string, title?: string) => {
            if (!noteId) return;

            // Skip if content hasn't actually changed from original (hash comparison)
            // This prevents false "unsaved changes" on editor initialization
            // Hash comparison is O(n) once then O(1), better than string compare for large content
            if (originalContentHash != null && hashString(content) === originalContentHash) {
                return;
            }

            // Clear any pending autosave
            if (timeoutRef.current) {
                clearTimeout(timeoutRef.current);
            }

            // Update draft content
            dispatch(setDraftContent({ noteId, content }));
            dispatch(markUnsaved(noteId));

            // Schedule autosave
            timeoutRef.current = setTimeout(() => {
                performAutosave(content, title);
            }, AUTOSAVE_DELAY_MS);
        },
        [dispatch, noteId, performAutosave, originalContentHash]
    );

    // Force save immediately
    const forceSave = useCallback(
        (content: string, title?: string) => {
            if (!noteId) return;

            // Clear any pending autosave
            if (timeoutRef.current) {
                clearTimeout(timeoutRef.current);
            }

            performAutosave(content, title);
        },
        [noteId, performAutosave]
    );

    // Cleanup on unmount
    useEffect(() => {
        return () => {
            if (timeoutRef.current) {
                clearTimeout(timeoutRef.current);
            }
        };
    }, []);

    return {
        isSaving,
        lastSaved,
        error,
        hasUnsavedChanges,
        draftContent,
        scheduleAutosave,
        forceSave,
    };
}

/**
 * Hook for loading a note's content.
 */
export function useNoteLoader(noteId: string | null) {
    const dispatch = useAppDispatch();
    const note = useAppSelector((state) =>
        noteId ? state.notes.notes[noteId] : null
    );
    const loadingNoteId = useAppSelector((state) => state.notes.loadingNoteId);
    const isLoading = loadingNoteId === noteId;

    const loadNote = useCallback(() => {
        if (noteId && !note) {
            dispatch(fetchNote(noteId));
        }
    }, [dispatch, noteId, note]);

    // Auto-load when noteId changes
    useEffect(() => {
        loadNote();
    }, [loadNote]);

    return {
        note,
        isLoading,
        loadNote,
    };
}

/**
 * Hook for getting the current note with draft content overlay.
 */
export function useCurrentNote() {
    const currentNoteId = useAppSelector((state) => state.notes.currentNoteId);
    const note = useAppSelector((state) =>
        currentNoteId ? state.notes.notes[currentNoteId] : null
    );
    const draftContent = useAppSelector((state) =>
        currentNoteId ? state.editor.draftContent[currentNoteId] : null
    );

    // Return note with draft content if available
    const noteWithDraft = note
        ? {
            ...note,
            content: draftContent ?? note.content,
        }
        : null;

    return {
        noteId: currentNoteId,
        note: noteWithDraft,
        originalContent: note?.content,
        hasDraft: draftContent !== null && draftContent !== note?.content,
    };
}

/**
 * Hook for save status formatting.
 */
export function useSaveStatus(noteId: string | null) {
    const autosave = useAppSelector((state) => state.editor.autosave);
    const hasUnsavedChanges = useAppSelector((state) =>
        noteId ? state.editor.hasUnsavedChanges[noteId] : false
    );

    const isSaving = noteId ? autosave.isSaving[noteId] : false;
    const lastSaved = noteId ? autosave.lastSaved[noteId] : null;
    const error = noteId ? autosave.error[noteId] : null;

    const formatLastSaved = useCallback(() => {
        if (!lastSaved) return null;

        const now = Date.now();
        const diff = now - lastSaved;

        if (diff < 5000) return 'Just saved';
        if (diff < 60000) return 'Saved';

        const date = new Date(lastSaved);
        return `Saved at ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
    }, [lastSaved]);

    return {
        isSaving,
        hasUnsavedChanges,
        error,
        statusText: isSaving
            ? 'Saving...'
            : hasUnsavedChanges
                ? 'Unsaved changes'
                : formatLastSaved() || 'All changes saved',
    };
}
