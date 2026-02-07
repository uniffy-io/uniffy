import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  DotsThree,
  ShareNetwork,
  PencilSimple,
  Eye,
  EyeSlash,
  CodeSimple,
  BookmarkSimple,
  CaretRight,
  CaretDoubleRight,
  SidebarSimple,
  ArrowsClockwise,
  CheckCircle,
  WarningCircle,
  DotsThreeOutline,
} from '@phosphor-icons/react';
import { useAppDispatch, useAppSelector } from '@/app/hooks';
import type { SerializedNote } from '@/features/notes/store/notesThunks';
import { updateNoteIcon } from '@/features/notes/store/notesThunks';
import { setEditorMode, toggleMetadataPanel, toggleSidebar, toggleMarkdownPreview } from '@/features/notes/store/editorSlice';
import { updateNote } from '@/features/notes/store/notesSlice';
import { useSaveStatus } from '@/features/notes/hooks/useNotesHooks';
import { buildBreadcrumbPath, type BreadcrumbItem } from '@/features/notes/utils/notesTreeUtils';
import { expandNode, setSelectedNode } from '@/features/notes/store/notesTreeSlice';
import { setSidebarOpen } from '@/features/notes/store/editorSlice';
import type { NoteIcon } from '@/features/notes/utils/noteIconConstants';
import { renderNoteIcon } from '@/features/notes/utils/noteIcons';
import type { EditorMode } from '@/features/notes/store/editorSlice';
import { TagInput } from '@/features/notes/components/editor/TagInput';
import { IconPicker } from '@/features/notes/components/editor/IconPicker';
import { useBookmarkToggle } from '@/features/bookmarks';
import { useSharingDialog } from '@/features/sharing';
import { cn } from '@/shared/utils/cn';
import { ContentType } from '@/gen/common/v1/common_pb';
import { VisibilityScope } from '@/gen/notes/v1/notes_pb';

interface EditorHeaderProps {
  note: SerializedNote;
  canEdit?: boolean;
  canShare?: boolean;
}

/**
 * Collapsible breadcrumb that shows first item, collapsed middle items, and last 2 items
 * when there are more than 3 levels of nesting.
 * Clicking on a folder expands it in the tree and selects it.
 */
interface CollapsibleBreadcrumbProps {
  items: BreadcrumbItem[];
  noteVisibility?: VisibilityScope;
}

function CollapsibleBreadcrumb({ items, noteVisibility }: CollapsibleBreadcrumbProps) {
  const dispatch = useAppDispatch();
  const isSidebarOpen = useAppSelector((state) => state.editor.isSidebarOpen);
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

    // Expand the section containing these notes based on visibility
    const sectionId = noteVisibility === VisibilityScope.ORGANIZATION
      ? 'organization'
      : noteVisibility === VisibilityScope.GROUP
        ? 'shared' // Group notes appear in shared section for non-owners
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
  }, [dispatch, items, isSidebarOpen, noteVisibility]);

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

// Mock collaborators for demo
const mockCollaborators = [
  { id: '1', initials: 'JD', color: 'bg-blue-500' },
  { id: '2', initials: 'AM', color: 'bg-green-500' },
];

export function EditorHeader({ note, canEdit = true, canShare = false }: EditorHeaderProps) {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const editorState = useAppSelector((state) => state.editor);
  const allNotes = useAppSelector((state) => state.notes.notes);
  const settings = editorState?.settings;
  const editorMode = settings?.editorMode || 'crepe';
  const showMarkdownPreview = settings?.showMarkdownPreview ?? true;
  const isMetadataPanelOpen = editorState?.isMetadataPanelOpen ?? false;
  const isSidebarOpen = editorState?.isSidebarOpen ?? true;

  // Bookmark state
  const noteUrn = `urn:uniffy:content:NOTE:${note.id}`;
  const { isBookmarked, toggling: bookmarkToggling, toggle: toggleBookmark } = useBookmarkToggle(noteUrn);

  // Sharing dialog
  const { open: openSharingDialog } = useSharingDialog();

  // Track local edits separately from note title
  const [localTitle, setLocalTitle] = useState<string | null>(null);
  // Use localTitle if editing, otherwise use note.title directly
  const title = localTitle ?? note.title;

  // Icon picker state
  const [isIconPickerOpen, setIsIconPickerOpen] = useState(false);

  // Save status
  const { isSaving, hasUnsavedChanges, error: saveError, statusText } = useSaveStatus(note.id);

  // Build breadcrumb path from parent folders
  const breadcrumb = useMemo(() => {
    const notesArray = Object.values(allNotes);
    return buildBreadcrumbPath(notesArray, note.id);
  }, [allNotes, note.id]);

  
  const handleTitleChange = (value: string) => {
    setLocalTitle(value);
    // Title change will be saved via autosave
  };

  const handleTitleBlur = () => {
    // Save title on blur if changed
    if (localTitle !== null && localTitle !== note.title && localTitle.trim()) {
      dispatch(updateNote({ noteId: note.id, title: localTitle.trim() }));
    }
    // Reset local state after save
    setLocalTitle(null);
  };

  const handleIconChange = (icon: NoteIcon | null) => {
    // Close picker first to prevent unmounted component updates
    setIsIconPickerOpen(false);
    // Then dispatch the update
    dispatch(updateNoteIcon({ noteId: note.id, icon }));
  };

  const handleShare = () => {
    openSharingDialog(ContentType.NOTE, note.id, note.title || 'Untitled');
  };

  const handleTagClick = useCallback((tag: string) => {
    navigate(`/notes/tags?tag=${encodeURIComponent(tag)}`);
  }, [navigate]);
  
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


  // Format date
  const formatDate = (timestamp?: { seconds: bigint | number; nanos: number }) => {
    if (!timestamp) return '';
    const date = new Date(Number(timestamp.seconds) * 1000);
    return date.toLocaleDateString('en-US', { 
      month: 'short', 
      day: 'numeric', 
      year: 'numeric' 
    });
  };
  
  return (
    <div className="border-b border-border bg-card">
      {/* Top Bar: Breadcrumb + Actions */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-border/50">
        {/* Left: Sidebar Toggle + Breadcrumb */}
        <div className="flex items-center gap-2 min-w-0 overflow-hidden">
          {/* Sidebar toggle (show when sidebar is hidden) */}
          {!isSidebarOpen && (
            <button
              onClick={() => dispatch(toggleSidebar())}
              className="p-1.5 rounded-md bg-transparent hover:bg-muted transition-colors"
              title="Show sidebar (⌘\\)"
            >
              <CaretDoubleRight size={16} weight="bold" className="text-primary" />
            </button>
          )}
          
          {/* Breadcrumb */}
          <CollapsibleBreadcrumb items={breadcrumb} noteVisibility={note.visibility} />

          {/* Save Status */}
          <div className="flex items-center gap-1.5 ml-4 text-xs">
            {isSaving ? (
              <>
                <ArrowsClockwise size={14} weight="bold" className="text-muted-foreground animate-spin" />
                <span className="text-muted-foreground">{statusText}</span>
              </>
            ) : saveError ? (
              <>
                <WarningCircle size={14} weight="fill" className="text-red-500" />
                <span className="text-red-500">Save failed</span>
              </>
            ) : hasUnsavedChanges ? (
              <>
                <span className="w-2 h-2 rounded-full bg-amber-500" />
                <span className="text-muted-foreground">{statusText}</span>
              </>
            ) : (
              <>
                <CheckCircle size={14} weight="fill" className="text-green-500" />
                <span className="text-muted-foreground">{statusText}</span>
              </>
            )}
          </div>
        </div>
        
        {/* Right Actions */}
        <div className="flex items-center gap-1">
          {/* View Mode Selector */}
          <div className="flex items-center gap-0.5 mr-3 border-r border-border pr-3">
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
            
            {/* Preview Toggle (only in markdown mode) */}
            {editorMode === 'markdown' && (
              <button
                onClick={() => dispatch(toggleMarkdownPreview())}
                className={`flex items-center gap-1.5 px-2 py-1 rounded text-xs transition-colors ml-1 ${
                  showMarkdownPreview
                    ? 'text-primary bg-primary/10'
                    : 'text-muted-foreground hover:text-foreground hover:bg-muted'
                }`}
                title={showMarkdownPreview ? 'Hide Preview' : 'Show Preview'}
              >
                {showMarkdownPreview ? (
                  <EyeSlash size={14} weight="duotone" />
                ) : (
                  <Eye size={14} weight="duotone" />
                )}
                <span className="hidden md:inline">Preview</span>
              </button>
            )}
          </div>
          
          {/* Collaborators */}
          <div className="flex items-center -space-x-2 mr-2">
            {mockCollaborators.map((collab) => (
              <div
                key={collab.id}
                className={`w-7 h-7 rounded-full ${collab.color} border-2 border-card flex items-center justify-center text-white text-xs font-medium`}
                title={collab.initials}
              >
                {collab.initials}
              </div>
            ))}
            <button className="w-7 h-7 rounded-full bg-muted border-2 border-card flex items-center justify-center text-xs font-medium hover:bg-muted/80">
              +2
            </button>
          </div>
          
          {/* Bookmark Button */}
          <button
            onClick={toggleBookmark}
            disabled={bookmarkToggling}
            className="p-2 rounded-md bg-transparent hover:bg-muted transition-colors disabled:opacity-50"
            title={isBookmarked ? 'Remove bookmark' : 'Add bookmark'}
          >
            {isBookmarked ? (
              <BookmarkSimple size={20} weight="fill" className="text-primary" />
            ) : (
              <BookmarkSimple size={20} weight="duotone" className="text-primary" />
            )}
          </button>
          
          {/* Share Button - only show if user has share permission (admin/owner) */}
          {canShare && (
            <button
              onClick={handleShare}
              className="p-2 rounded-md bg-transparent hover:bg-muted transition-colors"
              title="Share"
            >
              <ShareNetwork size={20} weight="duotone" className="text-primary" />
            </button>
          )}
          
          {/* More Options */}
          <button
            className="p-2 rounded-md bg-transparent hover:bg-muted transition-colors"
            title="More Options"
          >
            <DotsThree size={20} weight="bold" className="text-primary" />
          </button>
          
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
      
      {/* Title Section */}
      <div className="px-8 pt-6 pb-2">
        <div className="flex items-start gap-4">
          {/* Note Icon/Emoji */}
          <div className="relative mt-1">
            <button
              onClick={() => canEdit && setIsIconPickerOpen(!isIconPickerOpen)}
              className={`p-2 rounded-lg transition-colors ${
                canEdit ? 'hover:bg-accent cursor-pointer' : 'cursor-not-allowed opacity-60'
              }`}
              title={canEdit ? 'Change icon' : 'Read only'}
              disabled={!canEdit}
            >
              {renderNoteIcon(note.icon, "h-7 w-7 text-muted-foreground")}
            </button>
            {isIconPickerOpen && canEdit && (
              <IconPicker
                currentIcon={note.icon}
                onSelect={handleIconChange}
                onClose={() => setIsIconPickerOpen(false)}
              />
            )}
          </div>

          <div className="flex-1 min-w-0">
            {/* Title Input */}
            <input
              type="text"
              value={title}
              onChange={(e) => canEdit && handleTitleChange(e.target.value)}
              onBlur={handleTitleBlur}
              placeholder="Untitled"
              readOnly={!canEdit}
              className={`w-full text-3xl font-bold bg-transparent border-none outline-none focus:ring-0 text-foreground ${
                !canEdit ? 'cursor-not-allowed opacity-80' : ''
              }`}
            />
            
            {/* Meta Info */}
            <div className="flex items-center gap-4 mt-2 text-sm text-muted-foreground">
              <span>Created {formatDate(note.createdAt)}</span>
              {note.updatedAt && (
                <>
                  <span>·</span>
                  <span>Updated {formatDate(note.updatedAt)}</span>
                </>
              )}
              {/* Sharing info: show owner for shared notes (but not org-wide notes) */}
              {note.ownerInfo && note.visibility !== VisibilityScope.ORGANIZATION && (
                <>
                  <span>·</span>
                  <span className="text-blue-500">
                    Shared by {note.ownerInfo.name}
                  </span>
                </>
              )}
              {/* Sharing info: show share count for notes owned by user */}
              {note.sharedWith && note.sharedWith.length > 0 && (
                <>
                  <span>·</span>
                  <span className="text-blue-500">
                    Shared with {note.sharedWith.length} {note.sharedWith.length === 1 ? 'person' : 'people'}
                  </span>
                </>
              )}
            </div>
          </div>
        </div>
        
        {/* Tags Row */}
        <div className="flex items-center gap-2 mt-4 ml-14">
          <TagInput
            tags={note.tags || []}
            onTagsChange={(newTags) => {
              dispatch(updateNote({ noteId: note.id, tags: newTags }));
            }}
            disabled={!canEdit}
            onTagClick={handleTagClick}
          />
        </div>
      </div>
    </div>
  );
}
