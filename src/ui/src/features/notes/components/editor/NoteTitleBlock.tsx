import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowsLeftRight, TextAlignLeft, TextAlignCenter, Check } from '@phosphor-icons/react';
import { useAppDispatch, useAppSelector } from '@/app/hooks';
import type { SerializedNote } from '@/features/notes/store/notesThunks';
import { updateNote, updateNoteIcon } from '@/features/notes/store/notesThunks';
import { setTitleAlignment } from '@/features/notes/store/editorSlice';
import type { NoteIcon } from '@/features/notes/utils/noteIconConstants';
import { renderNoteIcon } from '@/features/notes/utils/noteIcons';
import { IconPicker } from '@/features/notes/components/editor/IconPicker';
import { TagPicker } from '@/features/tags';
import { formatProtoDate } from '@/shared/utils/dateFormatting';
import { cn } from '@/shared/utils/cn';
import { SubjectAvatarById, useSubjectResolver } from '@/components/subject';
import { AccessMode } from '@uniffy/proto/common/v1/common_pb';

function AlignmentChip({
  alignment,
  onChange,
}: {
  alignment: 'left' | 'center';
  onChange: (value: 'left' | 'center') => void;
}) {
  const [open, setOpen] = useState(false);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      const t = e.target as Node;
      if (popoverRef.current?.contains(t)) return;
      if (buttonRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const toggle = () => {
    if (!open && buttonRef.current) setRect(buttonRef.current.getBoundingClientRect());
    setOpen((v) => !v);
  };

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={toggle}
        className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-xs text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
        title="Title alignment"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <ArrowsLeftRight size={14} weight="bold" />
        <span>Layout</span>
      </button>
      {open && rect && createPortal(
        <div
          ref={popoverRef}
          role="menu"
          style={{ position: 'fixed', top: rect.bottom + 4, left: rect.left, zIndex: 1000 }}
          className="min-w-[160px] rounded-md border border-border bg-card text-card-foreground shadow-lg p-1"
        >
          {(['left', 'center'] as const).map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => {
                onChange(value);
                setOpen(false);
              }}
              className="flex w-full items-center gap-2 px-3 py-1.5 rounded text-sm text-left hover:bg-muted"
            >
              {value === 'left' ? <TextAlignLeft size={14} weight="bold" /> : <TextAlignCenter size={14} weight="bold" />}
              <span className="flex-1 capitalize">{value}</span>
              {alignment === value && <Check size={14} weight="bold" className="text-primary" />}
            </button>
          ))}
        </div>,
        document.body,
      )}
    </>
  );
}

interface NoteTitleBlockProps {
  note: SerializedNote;
  canEdit: boolean;
  /** Tighter layout for canvas notes - smaller padding / title, no
   * bottom separator. Metadata + tags still render. */
  compact?: boolean;
}

export function NoteTitleBlock({ note, canEdit, compact = false }: NoteTitleBlockProps) {
  const dispatch = useAppDispatch();
  const currentUserId = useAppSelector((s) => s.auth.user?.id ?? '');
  const alignment = useAppSelector((s) => s.editor.settings.titleAlignment ?? 'left');

  const [localTitle, setLocalTitle] = useState<string | null>(null);
  const [isIconPickerOpen, setIsIconPickerOpen] = useState(false);

  // Resolve the owner's display name for the "By {name}" byline.
  const { subjects: ownerSubjects } = useSubjectResolver(note.ownerId ? [note.ownerId] : []);
  const ownerName = ownerSubjects[0]?.name
    ?? (note.ownerId === currentUserId ? 'You' : '');

  const title = localTitle !== null ? localTitle : note.title;

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- resetting local title when switching notes is valid
    setLocalTitle(null);
  }, [note.id]);

  const handleTitleChange = (value: string) => {
    if (!canEdit) return;
    setLocalTitle(value);
  };

  const handleTitleBlur = () => {
    if (localTitle !== null && localTitle !== note.title && localTitle.trim()) {
      dispatch(updateNote({ noteId: note.id, title: localTitle.trim() }));
    }
    setLocalTitle(null);
  };

  const handleIconChange = (icon: NoteIcon | null) => {
    setIsIconPickerOpen(false);
    dispatch(updateNoteIcon({ noteId: note.id, icon }));
  };

  const isSharedWithUser =
    note.accessMode !== AccessMode.OPEN_TO_ORG
    && note.ownerId
    && note.ownerId !== currentUserId;
  const isExplicitlySharedByUser =
    note.accessMode === AccessMode.EXPLICIT_MEMBERS && note.ownerId === currentUserId;

  const isCenter = alignment === 'center';

  return (
    <div
      className={cn(
        'group w-full',
        compact
          ? 'px-3 md:px-6 pt-2 pb-2'
          : 'px-4 md:px-12 lg:px-[120px] pt-10 pb-4',
      )}
    >
      {canEdit && !compact && (
        <div
          className={cn(
            'flex items-center mb-2 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity',
            isCenter ? 'justify-center' : 'justify-start',
          )}
        >
          <AlignmentChip
            alignment={alignment}
            onChange={(value) => dispatch(setTitleAlignment(value))}
          />
        </div>
      )}

      <div
        className={cn(
          'flex gap-3',
          compact
            ? 'items-center'
            : isCenter
              ? 'flex-col items-center text-center'
              : 'items-start',
        )}
      >
        {/* Icon picker chip */}
        <div className="relative shrink-0">
          <button
            onClick={() => canEdit && setIsIconPickerOpen((v) => !v)}
            className={cn(
              'rounded-lg transition-colors',
              compact ? 'p-1' : 'p-1.5',
              canEdit ? 'hover:bg-muted cursor-pointer' : 'cursor-not-allowed opacity-60',
            )}
            title={canEdit ? 'Change icon' : 'Read only'}
            disabled={!canEdit}
          >
            {renderNoteIcon(
              note.icon,
              compact ? 'h-5 w-5 text-muted-foreground' : 'h-8 w-8 text-muted-foreground',
            )}
          </button>
          {isIconPickerOpen && canEdit && (
            <IconPicker
              currentIcon={note.icon}
              onSelect={handleIconChange}
              onClose={() => setIsIconPickerOpen(false)}
            />
          )}
        </div>

        <div
          className={cn(
            'min-w-0',
            compact ? 'flex-1 flex items-center gap-3 flex-wrap' : isCenter ? 'w-full' : 'flex-1',
          )}
        >
          <input
            type="text"
            value={title}
            onChange={(e) => handleTitleChange(e.target.value)}
            onBlur={handleTitleBlur}
            placeholder="Untitled"
            readOnly={!canEdit}
            className={cn(
              'bg-transparent border-none outline-none focus:ring-0 text-foreground placeholder:text-muted-foreground/40',
              compact
                ? 'flex-1 min-w-0 text-base font-semibold'
                : 'w-full text-4xl font-bold',
              !compact && isCenter && 'text-center',
              !canEdit && 'cursor-not-allowed',
            )}
          />

          <div
            className={cn(
              'flex items-center gap-3 text-xs text-muted-foreground flex-wrap',
              compact ? '' : 'mt-2',
              !compact && isCenter && 'justify-center',
            )}
          >
            {note.ownerId && (
              <span className="inline-flex items-center gap-1.5">
                <SubjectAvatarById userId={note.ownerId} displayName={ownerName} size="xs" />
                <span>
                  By <span className="text-foreground/80">{ownerName || 'Unknown'}</span>
                </span>
              </span>
            )}
            {!compact && note.ownerId && <span>·</span>}
            {!compact && <span>Created {formatProtoDate(note.createdAt)}</span>}
            {!compact && note.updatedAt && (
              <>
                <span>·</span>
                <span>Updated {formatProtoDate(note.updatedAt)}</span>
              </>
            )}
            {isSharedWithUser && (
              <>
                {!compact && <span>·</span>}
                <span className="text-blue-500">Shared with you</span>
              </>
            )}
            {isExplicitlySharedByUser && (
              <>
                {!compact && <span>·</span>}
                <span className="text-blue-500">Shared</span>
              </>
            )}
          </div>

          <div
            className={cn(
              'flex',
              compact ? '' : 'mt-3',
              !compact && isCenter && 'justify-center',
            )}
          >
            <TagPicker
              selectedTagIds={note.tagIds ?? []}
              onChange={(tagIds) => {
                dispatch(updateNote({ noteId: note.id, tagIds }));
              }}
              disabled={!canEdit}
            />
          </div>
        </div>
      </div>

      {!compact && (
        <div className="mt-6 border-b border-border/60" aria-hidden="true" />
      )}
    </div>
  );
}
