import type { ReactNode } from 'react';
import { Panel, Group, Separator } from 'react-resizable-panels';

interface NotesLayoutProps {
  sidebar: ReactNode;
  editor: ReactNode;
  metadataPanel?: ReactNode;
  showSidebar?: boolean;
  showMetadataPanel?: boolean;
}

export function NotesLayout({ 
  sidebar, 
  editor, 
  metadataPanel, 
  showSidebar = true,
  showMetadataPanel = false 
}: NotesLayoutProps) {
  return (
    <div className="h-[calc(100vh-4rem)] bg-background overflow-hidden">
      <Group orientation="horizontal" className="h-full">
        {/* Left Sidebar */}
        {showSidebar && (
          <>
            <Panel 
              id="sidebar"
              defaultSize="280px"
              minSize="200px"
              maxSize="400px"
              className="bg-card overflow-hidden"
            >
              {sidebar}
            </Panel>
            
            <Separator className="w-1 bg-border hover:bg-primary/50 transition-colors cursor-col-resize data-[resize-handle-state=drag]:bg-primary" />
          </>
        )}
        
        {/* Main Editor Area */}
        <Panel id="editor" minSize="400px">
          <div className="h-full overflow-hidden bg-card">
            {editor}
          </div>
        </Panel>
        
        {/* Right Metadata Panel (conditional) */}
        {showMetadataPanel && metadataPanel && (
          <>
            <Separator className="w-1 bg-border hover:bg-primary/50 transition-colors cursor-col-resize data-[resize-handle-state=drag]:bg-primary" />
            <Panel 
              id="metadata"
              defaultSize="320px"
              minSize="250px"
              maxSize="450px"
              className="bg-card overflow-hidden"
            >
              {metadataPanel}
            </Panel>
          </>
        )}
      </Group>
    </div>
  );
}
