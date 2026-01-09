import { useAppSelector } from '@/app/hooks';

export function NotesMetadataPanel() {
  const { currentNoteId, notes } = useAppSelector((state) => state.notes);
  
  if (!currentNoteId) return null;
  
  const note = notes[currentNoteId];
  if (!note) return null;
  
  return (
    <div className="h-full overflow-y-auto p-4 bg-card">
      <h3 className="text-sm font-semibold mb-4">Note Info</h3>
      
      {/* Owner */}
      <div className="mb-4">
        <label className="text-xs font-medium text-muted-foreground block mb-1">Owner</label>
        <p className="text-sm">{note.ownerId}</p>
      </div>
      
      {/* Created */}
      {note.createdAt && (
        <div className="mb-4">
          <label className="text-xs font-medium text-muted-foreground block mb-1">Created</label>
          <p className="text-sm">
            {new Date(Number(note.createdAt.seconds) * 1000).toLocaleDateString()}
          </p>
        </div>
      )}
      
      {/* Updated */}
      {note.updatedAt && (
        <div className="mb-4">
          <label className="text-xs font-medium text-muted-foreground block mb-1">Last Updated</label>
          <p className="text-sm">
            {new Date(Number(note.updatedAt.seconds) * 1000).toLocaleString()}
          </p>
        </div>
      )}
      
      {/* Tags */}
      <div className="mb-4">
        <label className="text-xs font-medium text-muted-foreground block mb-2">Tags</label>
        {note.tags && note.tags.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {note.tags.map((tag) => (
              <span
                key={tag}
                className="px-2 py-1 text-xs rounded-md bg-muted text-muted-foreground"
              >
                #{tag}
              </span>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground italic">No tags</p>
        )}
      </div>
      
      {/* Actions */}
      <div className="space-y-2 pt-4 border-t border-border">
        <button className="w-full px-3 py-2 text-sm text-left rounded-md hover:bg-accent transition-colors">
          📤 Share
        </button>
        <button className="w-full px-3 py-2 text-sm text-left rounded-md hover:bg-accent transition-colors">
          📁 Move to Folder
        </button>
        <button className="w-full px-3 py-2 text-sm text-left rounded-md hover:bg-accent transition-colors">
          📋 Duplicate
        </button>
        <button className="w-full px-3 py-2 text-sm text-left rounded-md hover:bg-accent text-red-600 dark:text-red-400 transition-colors">
          🗑️ Delete
        </button>
      </div>
    </div>
  );
}
