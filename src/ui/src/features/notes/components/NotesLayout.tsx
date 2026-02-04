import { type ReactNode, useState, useCallback } from 'react';
import { Panel, Group, Separator } from 'react-resizable-panels';
import { useAppSelector } from '@/app/hooks';
import { cn } from '@/shared/utils/cn';
import { loadPanelLayout, savePanelLayout } from '@/shared/utils/panelStorage';

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
  const isZenMode = useAppSelector((state) => state.zenMode.isActive);
  const [defaultLayout] = useState(() => loadPanelLayout('notes'));

  const handleLayoutChange = useCallback((layout: Record<string, number>) => {
    savePanelLayout('notes', layout);
  }, []);

  return (
    <div
      className={cn(
        "bg-background overflow-hidden transition-[height] duration-300 ease-in-out",
        isZenMode ? "h-screen delay-150" : "h-[calc(100vh-4rem)] delay-0"
      )}
    >
      <Group
        orientation="horizontal"
        className="h-full w-full flex"
        defaultLayout={defaultLayout}
        onLayoutChange={handleLayoutChange}
      >
        {/* Left Sidebar */}
        {showSidebar && (
          <>
            <Panel
              id="notes-sidebar"
              defaultSize={280}
              minSize={200}
              maxSize={500}
              className="bg-card overflow-hidden"
            >
              {sidebar}
            </Panel>

            <Separator className="w-1 bg-border hover:bg-primary/50 transition-colors cursor-col-resize data-[resize-handle-state=drag]:bg-primary" />
          </>
        )}

        {/* Main Editor Area */}
        <Panel id="notes-editor" minSize={400}>
          <div className="h-full overflow-hidden bg-card">
            {editor}
          </div>
        </Panel>

        {/* Right Metadata Panel (conditional) */}
        {showMetadataPanel && metadataPanel && (
          <>
            <Separator className="w-1 bg-border hover:bg-primary/50 transition-colors cursor-col-resize data-[resize-handle-state=drag]:bg-primary" />
            <Panel
              id="notes-metadata"
              defaultSize={300}
              minSize={200}
              maxSize={400}
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
