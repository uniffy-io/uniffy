import type { FC } from 'react';
import { ChevronRightIcon } from '@heroicons/react/24/outline';
import { useAppDispatch } from '@/app/hooks';
import { toggleNodeExpanded } from '../../store/notesTreeSlice';
import type { TreeNode as TreeNodeType } from '../../store/notesTreeSlice';
import { TreeNode } from './TreeNode';

interface TreeSectionProps {
  title: string;
  IconComponent: FC<{ className?: string }>;
  nodes: TreeNodeType[];
  sectionId: string;
  isExpanded: boolean;
  count?: number;
  accentColor?: string;
}

export function TreeSection({
  title,
  IconComponent,
  nodes,
  sectionId,
  isExpanded,
  count = 0,
  accentColor = 'text-muted-foreground',
}: TreeSectionProps) {
  const dispatch = useAppDispatch();
  
  const handleToggle = () => {
    dispatch(toggleNodeExpanded(sectionId));
  };
  
  return (
    <div className="mb-1">
      {/* Section Header */}
      <button
        onClick={handleToggle}
        className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-accent/50 transition-colors group"
      >
        <ChevronRightIcon
          className={`h-3.5 w-3.5 text-muted-foreground transition-transform ${
            isExpanded ? 'rotate-90' : ''
          }`}
        />
        <IconComponent className="h-4 w-4 text-muted-foreground" />
        <span className={`text-sm font-semibold ${accentColor} flex-1 text-left`}>
          {title}
        </span>
        {count > 0 && (
          <span className="text-xs text-muted-foreground px-1.5 py-0.5 rounded bg-muted">
            {count}
          </span>
        )}
      </button>
      
      {/* Section Content */}
      {isExpanded && nodes.length > 0 && (
        <div className="ml-4 mt-1 space-y-0.5">
          {nodes.map((node) => (
            <TreeNode key={node.id} node={node} />
          ))}
        </div>
      )}
      
      {/* Empty Section Message */}
      {isExpanded && nodes.length === 0 && (
        <div className="ml-6 px-2 py-2 text-xs text-muted-foreground italic">
          No notes
        </div>
      )}
    </div>
  );
}
