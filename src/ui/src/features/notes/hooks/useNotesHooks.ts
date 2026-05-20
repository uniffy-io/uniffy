/**
 * Notes Hooks
 *
 * Custom hooks for notes feature functionality.
 */

import { useCallback, useEffect } from 'react';
import { useAppDispatch, useAppSelector } from '@/app/hooks';
import { fetchNote } from '@/features/notes/store/notesSlice';

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
 * Hook for getting the current note.
 */
export function useCurrentNote() {
    const currentNoteId = useAppSelector((state) => state.notes.currentNoteId);
    const note = useAppSelector((state) =>
        currentNoteId ? state.notes.notes[currentNoteId] : null
    );

    return {
        noteId: currentNoteId,
        note,
        originalContent: note?.content,
    };
}
