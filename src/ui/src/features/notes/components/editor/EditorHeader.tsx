import { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import {
  ShareNetwork,
  PencilSimple,
  Eye,
  CodeSimple,
  CaretRight,
  SidebarSimple,
  ArrowsClockwise,
  CheckCircle,
  WarningCircle,
  DotsThreeOutline,
  PushPin,
  PushPinSlash,
} from '@phosphor-icons/react';
import { useAppDispatch, useAppSelector } from '@/app/hooks';
import type { SerializedNote } from '@/features/notes/store/notesThunks';
import { setEditorMode, toggleMetadataPanel, toggleToolbarPin } from '@/features/notes/store/editorSlice';
import { useSaveStatus } from '@/features/notes/hooks/useNotesHooks';
import { buildBreadcrumbPath, type BreadcrumbItem } from '@/features/notes/utils/notesTreeUtils';
import { expandNode, setSelectedNode } from '@/features/notes/store/notesTreeSlice';
import { setSidebarOpen } from '@/features/notes/store/editorSlice';
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
import { AccessMode } from '@uniffy/proto/common/v1/common_pb';

interface EditorHeaderProps {
  note: SerializedNote;
  canEdit?: boolean;
  canShare?: boolean;
  isCanvas?: boolean;
}

/**
 * Collapsible breadcrumb that shows first item, collapsed middle items, and last 2 items
 * when there are more than 3 levels of nesting.
 * Clicking on a folder expands it in the tree and selects it.
 */
interface CollapsibleBreadcrumbProps {
  items: BreadcrumbItem[];
  noteAccessMode?: number;
  noteOwnerId?: string;
}

function CollapsibleBreadcrumb({ items, noteAccessMode, noteOwnerId }: CollapsibleBreadcrumbProps) {
  const dispatch = useAppDispatch();
  const isSidebarOpen = useAppSelector((state) => state.editor.isSidebarOpen);
  const currentUserId = useAppSelector((s) => s.auth.user?.id ?? '');
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    if (!isDropdownOpen) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsDropdownOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isDropdownOpen]);

  // Handle clicking on a breadcrumb item - expand all ancestors and select the folder
  const handleItemClick = useCallback((item: BreadcrumbItem, itemIndex: number) => {
    // Only handle clicks on folders (not the current note which is the last item)
    if (itemIndex === items.length - 1) return;

    // Open sidebar if closed
    if (!isSidebarOpen) {
      dispatch(setSidebarOpen(true));
    }

    const sectionId = noteAccessMode === AccessMode.OPEN_TO_ORG
      ? 'organization'
      : noteOwnerId !== currentUserId
        ? 'shared'
        : 'personal';
    dispatch(expandNode(sectionId));

    // Expand all folders from root to the clicked item
    for (let i = 0; i <= itemIndex; i++) {
      if (items[i].isFolder) {
        dispatch(expandNode(items[i].id));
      }
    }

    // Select the clicked folder (for visual highlight)
    dispatch(setSelectedNode(item.id));

    // Scroll to the folder in the tree after a short delay to allow expansion
    setTimeout(() => {
      const folderElement = document.querySelector(`[data-node-id="${item.id}"]`);
      if (folderElement) {
        folderElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }, 100);
  }, [dispatch, items, isSidebarOpen, noteAccessMode, noteOwnerId, currentUserId]);

  // If 3 or fewer items, show all
  if (items.length <= 3) {
    return (
      <nav className="flex items-center gap-1 text-sm text-muted-foreground min-w-0">
        {items.map((item, index) => {
          const isLast = index === items.length - 1;
          const isClickable = !isLast && item.isFolder;
          return (
            <span key={item.id} className="flex items-center gap-1 min-w-0">
              {index > 0 && <CaretRight size={12} weight="bold" className="shrink-0" />}
              <span
                onClick={() => isClickable && handleItemClick(item, index)}
                className={`truncate max-w-[150px] ${isLast ? 'text-foreground font-medium' : 'hover:text-foreground cursor-pointer hover:underline'}`}
                title={item.title}
              >
                {item.title}
              </span>
            </span>
          );
        })}
      </nav>
    );
  }

  // For 4+ items: show first, ..., last 2
  const firstItem = items[0];
  const collapsedItems = items.slice(1, -2);
  const lastTwoItems = items.slice(-2);
  const lastTwoStartIndex = items.length - 2;

  return (
    <nav className="flex items-center gap-1 text-sm text-muted-foreground min-w-0">
      {/* First item */}
      <span
        onClick={() => firstItem.isFolder && handleItemClick(firstItem, 0)}
        className="truncate max-w-[120px] hover:text-foreground cursor-pointer hover:underline"
        title={firstItem.title}
      >
        {firstItem.title}
      </span>

      <CaretRight size={12} weight="bold" className="shrink-0" />

      {/* Collapsed items dropdown */}
      <div className="relative" ref={dropdownRef}>
        <button
          onClick={() => setIsDropdownOpen(!isDropdownOpen)}
          className="flex items-center justify-center w-6 h-6 rounded hover:bg-muted transition-colors"
          title={`${collapsedItems.length} more folder${collapsedItems.length > 1 ? 's' : ''}`}
        >
          <DotsThreeOutline size={14} weight="fill" />
        </button>

        {isDropdownOpen && (
          <div className="absolute top-full left-0 mt-1 py-1 min-w-[160px] max-w-[240px] bg-card border border-border rounded-lg shadow-lg z-50">
            {collapsedItems.map((item, index) => (
              <button
                key={item.id}
                onClick={() => {
                  handleItemClick(item, index + 1); // +1 because firstItem is at index 0
                  setIsDropdownOpen(false);
                }}
                className="w-full px-3 py-1.5 text-left text-sm hover:bg-muted truncate"
                title={item.title}
              >
                {item.title}
              </button>
            ))}
          </div>
        )}
      </div>

      <CaretRight size={12} weight="bold" className="shrink-0" />

      {/* Last two items */}
      {lastTwoItems.map((item, index) => {
        const actualIndex = lastTwoStartIndex + index;
        const isLast = actualIndex === items.length - 1;
        const isClickable = !isLast && item.isFolder;
        return (
          <span key={item.id} className="flex items-center gap-1 min-w-0">
            {index > 0 && <CaretRight size={12} weight="bold" className="shrink-0" />}
            <span
              onClick={() => isClickable && handleItemClick(item, actualIndex)}
              className={`truncate max-w-[150px] ${isLast ? 'text-foreground font-medium' : 'hover:text-foreground cursor-pointer hover:underline'}`}
              title={item.title}
            >
              {item.title}
            </span>
          </span>
        );
      })}
    </nav>
  );
}

export function EditorHeader({ note, canEdit = true, canShare = false, isCanvas = false }: EditorHeaderProps) {
  const dispatch = useAppDispatch();
  const editorState = useAppSelector((state) => state.editor);
  const allNotes = useAppSelector((state) => state.notes.notes);
  const settings = editorState?.settings;
  const editorMode = settings?.editorMode || 'crepe';
  const isMetadataPanelOpen = editorState?.isMetadataPanelOpen ?? false;
  const toolbarPinned = editorState?.settings?.toolbarPinned ?? true;

  const { openFor: openAccessDialog } = useAccessPolicyDialog();

  // Save status
  const { isSaving, hasUnsavedChanges, error: saveError, statusText } = useSaveStatus(note.id);

  // Build breadcrumb path from parent folders
  const breadcrumb = useMemo(() => {
    const notesArray = Object.values(allNotes);
    return buildBreadcrumbPath(notesArray, note.id);
  }, [allNotes, note.id]);

  const handleShare = () => {
    openAccessDialog(ContentType.NOTE, note.id, note.title || 'Untitled');
  };

  // Only show edit modes if user has edit permission
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
      {/* Top Bar: Breadcrumb + Actions */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-border/50">
        {/* Left: Sidebar Toggle + Breadcrumb */}
        <div className="flex items-center gap-2 min-w-0 overflow-hidden">
          {/* Breadcrumb */}
          <CollapsibleBreadcrumb items={breadcrumb} noteAccessMode={note.accessMode} noteOwnerId={note.ownerId} />

          {/* Save Status */}
          <div className="flex items-center gap-1.5 ml-2 md:ml-4 text-xs">
            {isSaving ? (
              <>
                <ArrowsClockwise size={14} weight="bold" className="text-muted-foreground animate-spin" />
                <span className="hidden sm:inline text-muted-foreground">{statusText}</span>
              </>
            ) : saveError ? (
              <>
                <WarningCircle size={14} weight="fill" style={{ color: 'var(--status-error)' }} />
                <span className="hidden sm:inline" style={{ color: 'var(--status-error)' }}>Save failed</span>
              </>
            ) : hasUnsavedChanges ? (
              <>
                <span className="w-2 h-2 rounded-full" style={{ backgroundColor: 'var(--status-warning)' }} />
                <span className="hidden sm:inline text-muted-foreground">{statusText}</span>
              </>
            ) : (
              <>
                <CheckCircle size={14} weight="fill" style={{ color: 'var(--status-success)' }} />
                <span className="hidden sm:inline text-muted-foreground">{statusText}</span>
              </>
            )}
          </div>
        </div>

        {/* Right Actions */}
        <div className="flex items-center gap-1">
          {/* View Mode Selector - hidden for canvas notes, hidden on mobile */}
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

          {/* Share Button - only show if user has share permission (admin/owner) */}
          {canShare && (
            <button
              onClick={handleShare}
              className="px-2 py-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              title="Share"
            >
              <ShareNetwork size={16} weight="bold" />
            </button>
          )}

          {/* Toolbar pin toggle - only in crepe edit mode */}
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

          {/* Right panel toggle */}
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
