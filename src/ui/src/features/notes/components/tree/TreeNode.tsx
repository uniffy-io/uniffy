import { DocumentTextIcon, FolderIcon, ChevronRightIcon } from '@heroicons/react/24/outline';
import { useAppDispatch, useAppSelector } from '@/app/hooks';
import { setCurrentNote } from '../../store/notesSlice';
import { setSelectedNode, toggleNodeExpanded } from '../../store/notesTreeSlice';
import type { TreeNode as TreeNodeType } from '../../store/notesTreeSlice';
import { cn } from '@/utils/cn';

interface TreeNodeProps {
  node: TreeNodeType;
  depth?: number;
}

export function TreeNode({ node, depth = 0 }: TreeNodeProps) {
  const dispatch = useAppDispatch();
  const { selectedNodeId, expandedNodes } = useAppSelector((state) => state.notesTree);
  const { currentNoteId } = useAppSelector((state) => state.notes);
  
  const isExpanded = expandedNodes.includes(node.id);
  const isSelected = selectedNodeId === node.id || currentNoteId === node.noteId;
  const hasChildren = node.children && node.children.length > 0;
  
  const handleClick = () => {
    if (node.type === 'folder') {
      dispatch(toggleNodeExpanded(node.id));
      dispatch(setSelectedNode(node.id));
    } else {
      dispatch(setSelectedNode(node.id));
      if (node.noteId) {
        dispatch(setCurrentNote(node.noteId));
      }
    }
  };
  
  return (
    <div>
      {/* Node Item */}
      <button
        onClick={handleClick}
        className={cn(
          'w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-sm transition-colors group',
          isSelected 
            ? 'bg-accent border-l-2 border-primary' 
            : 'hover:bg-accent/50'
        )}
        style={{ paddingLeft: `${0.5 + depth * 0.75}rem` }}
      >
        {/* Expand Icon (for folders) */}
        {hasChildren && (
          <ChevronRightIcon
            className={cn(
              'h-3.5 w-3.5 text-muted-foreground transition-transform flex-shrink-0',
              isExpanded && 'rotate-90'
            )}
          />
        )}
        
        {/* Node Icon */}
        {node.type === 'folder' ? (
          <FolderIcon className="h-4 w-4 text-muted-foreground flex-shrink-0" />
        ) : (
          <DocumentTextIcon className="h-4 w-4 text-muted-foreground flex-shrink-0" />
        )}
        
        {/* Pin Indicator */}
        {node.isPinned && <span className="text-xs">📌</span>}
        
        {/* Title */}
        <span className={cn(
          'flex-1 text-left truncate',
          isSelected ? 'font-medium' : 'font-normal'
        )}>
          {node.title}
        </span>
      </button>
      
      {/* Children (for folders) */}
      {isExpanded && hasChildren && (
        <div className="mt-0.5 space-y-0.5">
          {node.children!.map((child) => (
            <TreeNode key={child.id} node={child} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  );
}
