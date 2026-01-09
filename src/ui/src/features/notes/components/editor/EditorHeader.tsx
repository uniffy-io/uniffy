import { useState } from 'react';
import { 
  EllipsisVerticalIcon, 
  ShareIcon, 
  PencilSquareIcon,
  EyeIcon,
  Squares2X2Icon 
} from '@heroicons/react/24/outline';
import type { Note } from '@/gen/notes/v1/notes_pb';
import type { PlainMessage } from '@bufbuild/protobuf';
import { VisibilityScope } from '@/gen/notes/v1/notes_pb';
import { useAppDispatch, useAppSelector } from '@/app/hooks';
import { setPreviewMode } from '../../store/editorSlice';

interface EditorHeaderProps {
  note: PlainMessage<Note>;
}

const visibilityConfig: Record<VisibilityScope, {
  icon: string;
  label: string;
  color: string;
}> = {
  [VisibilityScope.PRIVATE]: {
    icon: '🔒',
    label: 'Personal',
    color: 'text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/20',
  },
  [VisibilityScope.GROUP]: {
    icon: '👥',
    label: 'Group',
    color: 'text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-950/20',
  },
  [VisibilityScope.ORGANIZATION]: {
    icon: '🏢',
    label: 'Organization',
    color: 'text-orange-600 dark:text-orange-400 bg-orange-50 dark:bg-orange-950/20',
  },
  [VisibilityScope.PUBLIC]: {
    icon: '🌐',
    label: 'Public',
    color: 'text-purple-600 dark:text-purple-400 bg-purple-50 dark:bg-purple-950/20',
  },
  [VisibilityScope.UNSPECIFIED]: {
    icon: '📄',
    label: 'Note',
    color: 'text-muted-foreground bg-muted',
  },
};

export function EditorHeader({ note }: EditorHeaderProps) {
  const dispatch = useAppDispatch();
  const { previewMode } = useAppSelector((state) => state.editor.settings);
  const [title, setTitle] = useState(note.title);
  
  const visInfo = visibilityConfig[note.visibility] || visibilityConfig[VisibilityScope.UNSPECIFIED];
  
  const handleTitleChange = (value: string) => {  setTitle(value);
    // TODO: Debounced title update
  };
  
  const handleShare = () => {
    // TODO: Open share modal
    console.log('Share note');
  };
  
  const viewModes: Array<{
    mode: 'edit' | 'split' | 'preview';
    icon: typeof PencilSquareIcon;
    label: string;
  }> = [
    { mode: 'edit', icon: PencilSquareIcon, label: 'Edit' },
    { mode: 'split', icon: Squares2X2Icon, label: 'Split' },
    { mode: 'preview', icon: EyeIcon, label: 'Preview' },
  ];
  
  return (
    <div className="border-b border-border p-4">
      {/* Title Input */}
      <input
        type="text"
        value={title}
        onChange={(e) => handleTitleChange(e.target.value)}
        placeholder="Untitled"
        className="w-full text-2xl font-semibold bg-transparent border-none outline-none focus:ring-0 mb-3"
      />
      
      {/* Metadata Row */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          {/* Visibility Badge */}
          <span className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-medium ${visInfo.color}`}>
            <span>{visInfo.icon}</span>
            <span>{visInfo.label}</span>
          </span>
          
          {/* Pinned Badge */}
          {note.isPinned && (
            <span className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium text-yellow-600 dark:text-yellow-400 bg-yellow-50 dark:bg-yellow-950/20">
              📌 Pinned
            </span>
          )}
          
          {/* Tags */}
          {note.tags && note.tags.length > 0 && (
            <div className="flex items-center gap-1">
              {note.tags.slice(0, 3).map((tag) => (
                <span
                  key={tag}
                  className="px-2 py-1 text-xs rounded-md bg-muted text-muted-foreground"
                >
                  #{tag}
                </span>
              ))}
              {note.tags.length > 3 && (
                <span className="text-xs text-muted-foreground">
                  +{note.tags.length - 3}
                </span>
              )}
            </div>
          )}
        </div>
        
        {/* Action Buttons */}
        <div className="flex items-center gap-2">
          {/* View Mode Selector */}
          <div className="flex items-center bg-muted rounded-md p-0.5">
            {viewModes.map(({ mode, icon: Icon, label }) => (
              <button
                key={mode}
                onClick={() => dispatch(setPreviewMode(mode))}
                className={`p-1.5 rounded transition-colors ${
                  previewMode === mode
                    ? 'bg-background shadow-sm'
                    : 'hover:bg-background/50'
                }`}
                title={label}
              >
                <Icon className="h-4 w-4" />
              </button>
            ))}
          </div>
          
          <div className="w-px h-5 bg-border" />
          
          <button
            onClick={handleShare}
            className="p-2 rounded-md hover:bg-accent transition-colors"
            title="Share"
          >
            <ShareIcon className="h-4 w-4" />
          </button>
          
          <button
            className="p-2 rounded-md hover:bg-accent transition-colors"
            title="More Options"
          >
            <EllipsisVerticalIcon className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
