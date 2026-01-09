import type { ReactNode } from 'react';

interface NotesLayoutProps {
  treeNav: ReactNode;
  editor: ReactNode;
  metadataPanel?: ReactNode;
  showMetadataPanel?: boolean;
}

export function NotesLayout({ treeNav, editor, metadataPanel, showMetadataPanel = false }: NotesLayoutProps) {
  return (
    <div className="flex h-[calc(100vh-4rem)] bg-background overflow-hidden">
      <div className="flex flex-1 overflow-hidden">
        {/* Left Panel: Tree Navigator */}
        <div className="w-80 border-r border-border flex-shrink-0 overflow-y-auto">
          {treeNav}
        </div>

        {/* Center Panel: Editor */}
        <div className="flex-1 overflow-hidden">
          {editor}
        </div>

        {/* Right Panel: Metadata (Conditional) */}
        {showMetadataPanel && metadataPanel && (
          <div className="w-80 border-l border-border flex-shrink-0 overflow-y-auto">
            {metadataPanel}
          </div>
        )}
      </div>
    </div>
  );
}
