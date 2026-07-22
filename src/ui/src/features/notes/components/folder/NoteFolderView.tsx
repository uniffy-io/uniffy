import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Folder, FolderPlus, FilePlus, PresentationChart } from '@phosphor-icons/react';
import { useAppSelector, useAppDispatch } from '@/app/hooks';
import { NoteBreadcrumbs } from '@/features/notes/components/NoteBreadcrumbs';
import { buildBreadcrumbPath } from '@/features/notes/utils/notesTreeUtils';
import { renderNoteIcon } from '@/features/notes/utils/noteIcons';
import { createNote } from '@/features/notes/store/notesThunks';
import type { SerializedNote } from '@/features/notes/store/notesThunks';
import { NodeType } from '@uniffy/proto/notes/v1/notes_pb';
import { ContentType } from '@uniffy/proto/common/v1/common_pb';
import { useMyContentRole } from '@/features/permissions';
import { roleCanEdit } from '@/shared/utils/contentRoles';
import { formatProtoDate } from '@/shared/utils/dateFormatting';
import { cn } from '@/shared/utils/cn';

function childSort(a: SerializedNote, b: SerializedNote): number {
    const aFolder = a.nodeType === NodeType.FOLDER;
    const bFolder = b.nodeType === NodeType.FOLDER;
    if (aFolder !== bFolder) return aFolder ? -1 : 1;
    return a.title.localeCompare(b.title, undefined, { sensitivity: 'base' });
}

function ChildIcon({ child }: { child: SerializedNote }) {
    if (child.nodeType === NodeType.FOLDER) {
        return <Folder size={18} weight="duotone" className="text-muted-foreground" />;
    }
    if (child.nodeType === NodeType.CANVAS) {
        return <PresentationChart size={18} weight="duotone" className="text-muted-foreground" />;
    }
    return renderNoteIcon(child.icon, 'h-[18px] w-[18px] text-muted-foreground');
}

export function NoteFolderView() {
    const dispatch = useAppDispatch();
    const navigate = useNavigate();
    const notesState = useAppSelector((state) => state.notes);
    const [isCreating, setIsCreating] = useState(false);

    const currentNoteId = notesState?.currentNoteId;
    const notes = notesState?.notes || {};
    const note = currentNoteId ? notes[currentNoteId] : null;

    const role = useMyContentRole(ContentType.NOTE, currentNoteId ?? '', note?.userRole);
    const canEdit = role === null ? true : roleCanEdit(role);

    const children = useMemo(
        () =>
            note
                ? Object.values(notes)
                      .filter((n) => n.parentId === note.id && !n.isDeleted)
                      .sort(childSort)
                : [],
        [notes, note],
    );

    const breadcrumb = useMemo(
        () => (note ? buildBreadcrumbPath(Object.values(notes), note.id) : []),
        [notes, note],
    );

    if (!note) {
        return null;
    }

    const folderCount = children.filter((c) => c.nodeType === NodeType.FOLDER).length;
    const noteCount = children.length - folderCount;

    const handleCreate = async (nodeType: NodeType) => {
        if (isCreating) return;
        setIsCreating(true);
        try {
            const created = await dispatch(
                createNote({
                    title: nodeType === NodeType.FOLDER ? 'New Folder' : 'Untitled Note',
                    content: '',
                    parentId: note.id,
                    nodeType,
                }),
            ).unwrap();
            navigate(`/notes/${created.id}`);
        } catch {
            // errorToastMiddleware surfaces the failure
        } finally {
            setIsCreating(false);
        }
    };

    const summary = [
        folderCount > 0 ? `${folderCount} folder${folderCount !== 1 ? 's' : ''}` : null,
        noteCount > 0 ? `${noteCount} note${noteCount !== 1 ? 's' : ''}` : null,
    ]
        .filter(Boolean)
        .join(' · ');

    return (
        <div className="flex flex-col h-full bg-card">
            <div className="border-b border-border px-4 py-2">
                <NoteBreadcrumbs
                    items={breadcrumb}
                    noteAccessMode={note.accessMode}
                    noteOwnerId={note.ownerId}
                />
            </div>
            <div className="flex-1 overflow-y-auto">
                <div className="w-full max-w-4xl mx-auto px-6 lg:px-12 pt-8">
                    <div className="flex items-center gap-3">
                        <Folder size={28} weight="duotone" className="text-muted-foreground shrink-0" />
                        <h1 className="text-3xl font-bold text-foreground truncate">{note.title}</h1>
                    </div>

                <div className="mt-6 border-t border-border/50 pt-4">
                    <div className="flex items-center justify-between mb-2">
                        <span className="text-xs text-muted-foreground">
                            {summary || 'Empty folder'}
                        </span>
                        {canEdit && (
                            <div className="flex items-center gap-1.5">
                                <button
                                    onClick={() => handleCreate(NodeType.NOTE)}
                                    disabled={isCreating}
                                    className={cn(
                                        'flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium',
                                        'text-muted-foreground hover:text-foreground hover:bg-muted transition-colors',
                                    )}
                                >
                                    <FilePlus size={14} weight="bold" />
                                    New note
                                </button>
                                <button
                                    onClick={() => handleCreate(NodeType.FOLDER)}
                                    disabled={isCreating}
                                    className={cn(
                                        'flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium',
                                        'text-muted-foreground hover:text-foreground hover:bg-muted transition-colors',
                                    )}
                                >
                                    <FolderPlus size={14} weight="bold" />
                                    New folder
                                </button>
                            </div>
                        )}
                    </div>

                    {children.length === 0 ? (
                        <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
                            <Folder size={32} weight="duotone" className="opacity-40 mb-3" />
                            <p className="text-sm">This folder is empty</p>
                            {canEdit && (
                                <p className="text-xs mt-1 opacity-60">
                                    Create a note or folder to get started
                                </p>
                            )}
                        </div>
                    ) : (
                        <ul className="pb-10">
                            {children.map((child) => (
                                <li key={child.id}>
                                    <button
                                        onClick={() => navigate(`/notes/${child.id}`)}
                                        className={cn(
                                            'w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left',
                                            'hover:bg-muted/50 transition-colors group',
                                        )}
                                    >
                                        <span className="grid place-items-center w-8 h-8 rounded-md bg-muted/60 shrink-0">
                                            <ChildIcon child={child} />
                                        </span>
                                        <span className="flex-1 min-w-0 text-sm font-medium text-foreground/80 group-hover:text-foreground truncate">
                                            {child.title}
                                        </span>
                                        <span className="text-xs text-muted-foreground/60 shrink-0 hidden sm:inline">
                                            {formatProtoDate(child.updatedAt)}
                                        </span>
                                    </button>
                                </li>
                            ))}
                        </ul>
                    )}
                    </div>
                </div>
            </div>
        </div>
    );
}
