/**
 * Trash Section Component
 *
 * Renders the trash section in the notes sidebar with restore and empty trash functionality.
 */

import { useState, useCallback } from 'react';
import {
    CaretDown,
    CaretRight,
    FileText,
    Trash,
    ArrowsClockwise,
    ArrowUUpLeft,
} from '@phosphor-icons/react';
import { useAppDispatch } from '@/app/hooks';
import { setCurrentNote, initializeNotesData, restoreNote } from '@/features/notes/store/notesSlice';
import { notesApi } from '@/features/notes/api/notesApi';
import { Button } from '@/components/ui/button';
import type { TreeNode } from '@/features/notes/components/sidebar/types';

interface TrashSectionProps {
    trashNodes: TreeNode[];
    currentNoteId: string | null;
    organizationId: string | null;
    onSelectNote: (noteId: string) => void;
}

export function TrashSection({
    trashNodes,
    currentNoteId,
    organizationId,
    onSelectNote,
}: TrashSectionProps) {
    const dispatch = useAppDispatch();
    const [showTrash, setShowTrash] = useState(false);
    const [emptyingTrash, setEmptyingTrash] = useState(false);
    const [showEmptyTrashConfirm, setShowEmptyTrashConfirm] = useState(false);
    const [restoringNoteId, setRestoringNoteId] = useState<string | null>(null);

    const handleEmptyTrashClick = useCallback(() => {
        if (trashNodes.length === 0 || !organizationId) return;
        setShowEmptyTrashConfirm(true);
    }, [trashNodes.length, organizationId]);

    const handleEmptyTrashConfirm = useCallback(async () => {
        if (!organizationId) return;

        try {
            setEmptyingTrash(true);
            await notesApi.emptyTrash({ organizationId });

            if (currentNoteId && trashNodes.some((n) => n.id === currentNoteId)) {
                dispatch(setCurrentNote(null));
            }

            dispatch(initializeNotesData({ forceRefresh: true }));
        } catch (error) {
            console.error('Failed to empty trash:', error);
        } finally {
            setEmptyingTrash(false);
            setShowEmptyTrashConfirm(false);
        }
    }, [organizationId, dispatch, currentNoteId, trashNodes]);

    const handleRestore = useCallback(async (noteId: string, e: React.MouseEvent) => {
        e.stopPropagation();
        try {
            setRestoringNoteId(noteId);
            await dispatch(restoreNote(noteId)).unwrap();
        } catch (error) {
            console.error('Failed to restore note:', error);
        } finally {
            setRestoringNoteId(null);
        }
    }, [dispatch]);

    if (trashNodes.length === 0) return null;

    return (
        <div className="mt-2 pt-2 border-t border-border">
            <div className="flex items-center gap-1">
                <button
                    onClick={() => setShowTrash(!showTrash)}
                    className="flex-1 flex items-center gap-2 px-2 py-2 text-sm rounded-md hover:bg-accent transition-colors text-left"
                >
                    {showTrash ? (
                        <CaretDown size={16} weight="bold" className="text-muted-foreground" />
                    ) : (
                        <CaretRight size={16} weight="bold" className="text-muted-foreground" />
                    )}
                    <Trash size={16} weight="duotone" className="text-muted-foreground" />
                    <span className="flex-1">Trash</span>
                </button>
                <button
                    onClick={handleEmptyTrashClick}
                    disabled={emptyingTrash || trashNodes.length === 0}
                    className="px-2 py-1.5 text-xs rounded-md hover:bg-destructive/10 hover:text-destructive transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    title="Empty trash"
                >
                    {emptyingTrash ? 'Emptying...' : 'Empty'}
                </button>
            </div>

            {showTrash && (
                <div className="ml-4 pl-2 border-l border-border space-y-0.5 mt-0.5">
                    {trashNodes.map((node) => (
                        <div
                            key={node.id}
                            onClick={() => onSelectNote(node.id)}
                            className={`group w-full flex items-center gap-2 px-2 py-1.5 text-sm rounded-md hover:bg-accent transition-colors text-left opacity-60 cursor-pointer ${currentNoteId === node.id ? 'bg-accent text-accent-foreground' : ''
                                }`}
                        >
                            <FileText size={16} weight="duotone" className="text-muted-foreground flex-shrink-0" />
                            <span className="truncate flex-1">{node.title}</span>
                            <button
                                onClick={(e) => handleRestore(node.id, e)}
                                disabled={restoringNoteId === node.id}
                                className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-primary/10 hover:text-primary transition-all disabled:opacity-50"
                                title="Restore"
                            >
                                {restoringNoteId === node.id ? (
                                    <ArrowsClockwise size={14} weight="bold" className="animate-spin" />
                                ) : (
                                    <ArrowUUpLeft size={14} weight="bold" />
                                )}
                            </button>
                        </div>
                    ))}
                </div>
            )}

            {/* Empty Trash Confirmation Modal */}
            {showEmptyTrashConfirm && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
                    <div className="bg-background w-full max-w-md rounded-xl shadow-2xl border border-border overflow-hidden animate-in zoom-in-95 duration-200">
                        {/* Header */}
                        <div className="flex items-center gap-3 px-6 py-4 border-b border-border bg-muted/30">
                            <div className="rounded-lg bg-destructive/10 p-2">
                                <Trash size={20} weight="duotone" className="text-destructive" />
                            </div>
                            <div>
                                <h2 className="text-lg font-semibold">Empty Trash</h2>
                                <p className="text-xs text-muted-foreground">This action cannot be undone</p>
                            </div>
                        </div>

                        {/* Body */}
                        <div className="p-6">
                            <p className="text-sm text-muted-foreground">
                                Are you sure you want to permanently delete{' '}
                                <span className="font-medium text-foreground">{trashNodes.length} item{trashNodes.length !== 1 ? 's' : ''}</span>{' '}
                                from the trash? This will free up space but the items cannot be recovered.
                            </p>
                        </div>

                        {/* Footer */}
                        <div className="flex justify-end gap-3 px-6 py-4 border-t border-border bg-muted/20">
                            <Button
                                variant="outline"
                                size="md"
                                onClick={() => setShowEmptyTrashConfirm(false)}
                                disabled={emptyingTrash}
                            >
                                Cancel
                            </Button>
                            <Button
                                variant="destructive"
                                size="md"
                                onClick={handleEmptyTrashConfirm}
                                disabled={emptyingTrash}
                            >
                                {emptyingTrash ? 'Deleting...' : 'Delete Permanently'}
                            </Button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
