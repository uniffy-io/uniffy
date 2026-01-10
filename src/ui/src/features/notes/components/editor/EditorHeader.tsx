import { useState } from 'react';
import { 
  EllipsisHorizontalIcon, 
  ShareIcon, 
  PencilSquareIcon,
  EyeIcon,
  EyeSlashIcon,
  CodeBracketIcon,
  StarIcon,
  ChevronRightIcon,
  PlusIcon,
  ChevronDoubleRightIcon,
  ChevronDoubleLeftIcon,
} from '@heroicons/react/24/outline';
import { StarIcon as StarIconSolid } from '@heroicons/react/24/solid';
import type { Note } from '@/gen/notes/v1/notes_pb';
import type { PlainMessage } from '@bufbuild/protobuf';
import { useAppDispatch, useAppSelector } from '@/app/hooks';
import { setEditorMode, toggleMetadataPanel, toggleStarredNote, toggleSidebar, toggleMarkdownPreview } from '../../store/editorSlice';
import type { EditorMode } from '../../store/editorSlice';

interface EditorHeaderProps {
  note: PlainMessage<Note>;
}

// Mock collaborators for demo
const mockCollaborators = [
  { id: '1', initials: 'JD', color: 'bg-blue-500' },
  { id: '2', initials: 'AM', color: 'bg-green-500' },
];

export function EditorHeader({ note }: EditorHeaderProps) {
  const dispatch = useAppDispatch();
  const editorState = useAppSelector((state) => state.editor);
  const settings = editorState?.settings;
  const editorMode = settings?.editorMode || 'crepe';
  const showMarkdownPreview = settings?.showMarkdownPreview ?? true;
  const isMetadataPanelOpen = editorState?.isMetadataPanelOpen ?? false;
  const isSidebarOpen = editorState?.isSidebarOpen ?? true;
  const starredNotes = editorState?.starredNotes || {};
  const [title, setTitle] = useState(note.title);
  
  const isStarred = starredNotes?.[note.id] || false;
  
  const handleTitleChange = (value: string) => {
    setTitle(value);
    // TODO: Debounced title update
  };
  
  const handleShare = () => {
    // TODO: Open share modal
    console.log('Share note');
  };
  
  const viewModes: Array<{
    mode: EditorMode;
    icon: typeof PencilSquareIcon;
    label: string;
  }> = [
    { mode: 'crepe', icon: PencilSquareIcon, label: 'Editor' },
    { mode: 'markdown', icon: CodeBracketIcon, label: 'Markdown' },
    { mode: 'readonly', icon: EyeIcon, label: 'Read Only' },
  ];

  // Mock breadcrumb - would come from parent folder structure
  const breadcrumb = ['Workspace', 'Engineering', note.title];

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
        <div className="flex items-center gap-2">
          {/* Sidebar toggle (show when sidebar is hidden) */}
          {!isSidebarOpen && (
            <button
              onClick={() => dispatch(toggleSidebar())}
              className="p-1.5 rounded-md bg-transparent hover:bg-muted transition-colors"
              title="Show sidebar (⌘\\)"
            >
              <ChevronDoubleRightIcon className="h-4 w-4 text-primary" />
            </button>
          )}
          
          {/* Breadcrumb */}
          <nav className="flex items-center gap-1 text-sm text-muted-foreground">
            {breadcrumb.map((item, index) => (
              <span key={index} className="flex items-center gap-1">
                {index > 0 && <ChevronRightIcon className="h-3 w-3" />}
                <span className={index === breadcrumb.length - 1 ? 'text-foreground font-medium' : 'hover:text-foreground cursor-pointer'}>
                  {item}
                </span>
              </span>
            ))}
          </nav>
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
                <Icon className="h-3.5 w-3.5" />
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
                  <EyeSlashIcon className="h-3.5 w-3.5" />
                ) : (
                  <EyeIcon className="h-3.5 w-3.5" />
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
          
          {/* Star Button */}
          <button
            onClick={() => dispatch(toggleStarredNote(note.id))}
            className="p-2 rounded-md bg-transparent hover:bg-muted transition-colors"
            title={isStarred ? 'Remove from favorites' : 'Add to favorites'}
          >
            {isStarred ? (
              <StarIconSolid className="h-5 w-5 text-primary" />
            ) : (
              <StarIcon className="h-5 w-5 text-primary" />
            )}
          </button>
          
          {/* Share Button */}
          <button
            onClick={handleShare}
            className="p-2 rounded-md bg-transparent hover:bg-muted transition-colors"
            title="Share"
          >
            <ShareIcon className="h-5 w-5 text-primary" />
          </button>
          
          {/* More Options */}
          <button
            className="p-2 rounded-md bg-transparent hover:bg-muted transition-colors"
            title="More Options"
          >
            <EllipsisHorizontalIcon className="h-5 w-5 text-primary" />
          </button>
          
          {/* Right panel toggle */}
          <button
            onClick={() => dispatch(toggleMetadataPanel())}
            className="p-1.5 rounded-md bg-transparent hover:bg-muted transition-colors"
            title={isMetadataPanelOpen ? 'Hide panel (⌘])' : 'Show panel (⌘])'}
          >
            {isMetadataPanelOpen ? (
              <ChevronDoubleRightIcon className="h-4 w-4 text-primary" />
            ) : (
              <ChevronDoubleLeftIcon className="h-4 w-4 text-primary" />
            )}
          </button>
        </div>
      </div>
      
      {/* Title Section */}
      <div className="px-8 pt-6 pb-2">
        <div className="flex items-start gap-4">
          {/* Note Icon/Emoji */}
          <button className="mt-1 p-2 rounded-lg hover:bg-accent transition-colors">
            <span className="text-2xl">📄</span>
          </button>
          
          <div className="flex-1 min-w-0">
            {/* Title Input */}
            <input
              type="text"
              value={title}
              onChange={(e) => handleTitleChange(e.target.value)}
              placeholder="Untitled"
              className="w-full text-3xl font-bold bg-transparent border-none outline-none focus:ring-0 text-foreground"
            />
            
            {/* Meta Info */}
            <div className="flex items-center gap-4 mt-2 text-sm text-muted-foreground">
              <span>Created {formatDate(note.createdAt)}</span>
              <span>·</span>
              <span>Last edited 2 hours ago by Sarah</span>
              <span>·</span>
              <span>4 collaborators</span>
            </div>
          </div>
        </div>
        
        {/* Tags Row */}
        <div className="flex items-center gap-2 mt-4 ml-14">
          {note.tags && note.tags.length > 0 ? (
            note.tags.map((tag) => (
              <span
                key={tag}
                className="px-2.5 py-1 text-xs font-medium rounded-full bg-primary/10 text-primary hover:bg-primary/20 transition-colors cursor-pointer"
              >
                #{tag}
              </span>
            ))
          ) : (
            <>
              <span className="px-2.5 py-1 text-xs font-medium rounded-full bg-emerald-100 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-400">
                #roadmap
              </span>
              <span className="px-2.5 py-1 text-xs font-medium rounded-full bg-blue-100 dark:bg-blue-950/30 text-blue-700 dark:text-blue-400">
                #q1-2026
              </span>
              <span className="px-2.5 py-1 text-xs font-medium rounded-full bg-red-100 dark:bg-red-950/30 text-red-700 dark:text-red-400">
                #priority
              </span>
            </>
          )}
          <button className="p-1 rounded-full hover:bg-muted transition-colors">
            <PlusIcon className="h-4 w-4 text-muted-foreground" />
          </button>
        </div>
      </div>
    </div>
  );
}
