import { useMemo } from 'react';
import {
  ShareNetwork,
  PencilSimple,
  Eye,
  CodeSimple,
  SidebarSimple,
  PushPin,
  PushPinSlash,
  CaretUp,
  CaretDown,
} from '@phosphor-icons/react';
import { useAppDispatch, useAppSelector } from '@/app/hooks';
import type { SerializedNote } from '@/features/notes/store/notesThunks';
import {
  setEditorMode,
  toggleCanvasTitleHidden,
  toggleMetadataPanel,
  toggleToolbarPin,
} from '@/features/notes/store/editorSlice';
import { RealtimeStatusBadge } from '@/features/notes/realtime/RealtimeStatusBadge';
import { RealtimePresence, type RealtimeStatus } from '@/features/realtime';
import type { Awareness } from 'y-protocols/awareness';
import { buildBreadcrumbPath } from '@/features/notes/utils/notesTreeUtils';
import { NoteBreadcrumbs } from '@/features/notes/components/NoteBreadcrumbs';
import type { EditorMode } from '@/features/notes/store/editorSlice';
import { MarkdownModeBar } from '@/features/notes/components/editor/MarkdownModeBar';
import { EditorFormattingToolbar } from '@/features/notes/components/editor/EditorFormattingToolbar';

function CollapsibleToolbarSlot({ children }: { children: React.ReactNode }) {
  const pinned = useAppSelector((s) => s.editor.settings.toolbarPinned ?? true);
  return (
    <div
      className="overflow-hidden transition-[max-height,opacity] duration-200 ease-in-out"
      style={{
        maxHeight: pinned ? '120px' : '0px',
        opacity: pinned ? 1 : 0,
      }}
    >
      {children}
    </div>
  );
}
import { useAccessPolicyDialog } from '@/features/permissions';
import { cn } from '@/shared/utils/cn';
import { ContentType } from '@uniffy/proto/common/v1/common_pb';

interface EditorHeaderProps {
  note: SerializedNote;
  canEdit?: boolean;
  canShare?: boolean;
  isCanvas?: boolean;
  realtimeStatus?: RealtimeStatus;
  realtimeAwareness?: Awareness | null;
}

export function EditorHeader({
  note,
  canEdit = true,
  canShare = false,
  isCanvas = false,
  realtimeStatus = 'idle',
  realtimeAwareness = null,
}: EditorHeaderProps) {
  const dispatch = useAppDispatch();
  const editorState = useAppSelector((state) => state.editor);
  const allNotes = useAppSelector((state) => state.notes.notes);
  const currentUser = useAppSelector((s) => s.auth.user);
  const settings = editorState?.settings;
  const editorMode = settings?.editorMode || 'crepe';
  const isMetadataPanelOpen = editorState?.isMetadataPanelOpen ?? false;
  const toolbarPinned = editorState?.settings?.toolbarPinned ?? true;
  const canvasTitleHidden = editorState?.settings?.canvasTitleHidden ?? false;

  const { openFor: openAccessDialog } = useAccessPolicyDialog();

  const breadcrumb = useMemo(() => {
    const notesArray = Object.values(allNotes);
    return buildBreadcrumbPath(notesArray, note.id);
  }, [allNotes, note.id]);

  const handleShare = () => {
    openAccessDialog(ContentType.NOTE, note.id, note.title || 'Untitled');
  };

  const viewModes: Array<{
    mode: EditorMode;
    icon: typeof PencilSimple;
    label: string;
  }> = canEdit
    ? [
        { mode: 'crepe', icon: PencilSimple, label: 'Editor' },
        { mode: 'markdown', icon: CodeSimple, label: 'Markdown' },
        { mode: 'readonly', icon: Eye, label: 'Read Only' },
      ]
    : [
        { mode: 'readonly', icon: Eye, label: 'Read Only' },
      ];


  return (
    <div className="border-b border-border bg-card">
      <div className="flex items-center justify-between px-4 py-2 border-b border-border/50">
        <div className="flex items-center gap-2 min-w-0 overflow-hidden">
          <NoteBreadcrumbs items={breadcrumb} noteAccessMode={note.accessMode} noteOwnerId={note.ownerId} />

          <div className="hidden sm:flex items-center gap-2 ml-2 md:ml-4">
            <RealtimeStatusBadge status={realtimeStatus} />
            {realtimeAwareness && (
              <RealtimePresence
                awareness={realtimeAwareness}
                localUserId={currentUser?.id ?? null}
                localUserName={currentUser?.fullName || currentUser?.username || null}
                localHasAvatar={Boolean(currentUser?.hasAvatar)}
              />
            )}
          </div>
        </div>

        <div className="flex items-center gap-1">
          {!isCanvas && <div className="hidden sm:flex items-center gap-0.5 mr-3 border-r border-border pr-3">
            {viewModes.map(({ mode, icon: Icon, label }) => (
              <button
                key={mode}
                onClick={() => dispatch(setEditorMode(mode))}
                className={`flex items-center gap-1.5 px-2 py-1 rounded text-xs transition-colors ${
                  editorMode === mode
                    ? 'text-primary bg-primary/10'
                    : 'text-muted-foreground hover:text-foreground hover:bg-muted'
                }`}
                title={label}
              >
                <Icon size={14} weight="duotone" />
                <span className="hidden md:inline">{label}</span>
              </button>
            ))}
          </div>}

          {canShare && (
            <button
              onClick={handleShare}
              className="px-2 py-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              title="Share"
            >
              <ShareNetwork size={16} weight="bold" />
            </button>
          )}

          {isCanvas && (
            <button
              onClick={() => dispatch(toggleCanvasTitleHidden())}
              className={cn(
                'px-2 py-1 rounded-md transition-colors',
                canvasTitleHidden
                  ? 'text-muted-foreground hover:text-foreground hover:bg-muted'
                  : 'text-primary bg-primary/10',
              )}
              title={canvasTitleHidden ? 'Show title block' : 'Hide title block'}
              aria-pressed={!canvasTitleHidden}
            >
              {canvasTitleHidden ? (
                <CaretDown size={16} weight="bold" />
              ) : (
                <CaretUp size={16} weight="bold" />
              )}
            </button>
          )}

          {!isCanvas && editorMode === 'crepe' && canEdit && (
            <button
              onClick={() => dispatch(toggleToolbarPin())}
              className={cn(
                'px-2 py-1 rounded-md transition-colors',
                toolbarPinned
                  ? 'text-primary bg-primary/10'
                  : 'text-muted-foreground hover:text-foreground hover:bg-muted'
              )}
              title={toolbarPinned ? 'Unpin formatting toolbar' : 'Pin formatting toolbar'}
            >
              {toolbarPinned ? (
                <PushPin size={16} weight="fill" />
              ) : (
                <PushPinSlash size={16} weight="bold" />
              )}
            </button>
          )}

          <button
            onClick={() => dispatch(toggleMetadataPanel())}
            className={cn(
              'px-2 py-1 rounded-md transition-colors',
              isMetadataPanelOpen
                ? 'text-primary bg-primary/10'
                : 'text-muted-foreground hover:text-foreground hover:bg-muted'
            )}
            title={isMetadataPanelOpen ? 'Hide panel' : 'Show panel'}
          >
            <SidebarSimple size={16} className="transform -scale-x-100" />
          </button>
        </div>
      </div>

      {!isCanvas && editorMode === 'markdown' && <MarkdownModeBar />}
      {!isCanvas && editorMode === 'crepe' && canEdit && (
        <CollapsibleToolbarSlot>
          <EditorFormattingToolbar noteId={note.id} />
        </CollapsibleToolbarSlot>
      )}
    </div>
  );
}
