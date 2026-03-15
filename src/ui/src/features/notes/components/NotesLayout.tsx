import { type ReactNode, useState, useCallback } from 'react';
import { Panel, Group, Separator } from 'react-resizable-panels';
import { useAppSelector } from '@/app/hooks';
import { cn } from '@/shared/utils/cn';
import { loadPanelLayout, savePanelLayout } from '@/shared/utils/panelStorage';
import { useBreakpoint } from '@/shared/hooks/useBreakpoint';
import { Drawer } from '@/components/ui/drawer';

interface NotesLayoutProps {
  sidebar: ReactNode;
  editor: ReactNode;
  metadataPanel?: ReactNode;
  showSidebar?: boolean;
  showMetadataPanel?: boolean;
  onCloseSidebar?: () => void;
  onCloseMetadataPanel?: () => void;
}

export function NotesLayout({
  sidebar,
  editor,
  metadataPanel,
  showSidebar = true,
  showMetadataPanel = false,
  onCloseSidebar,
  onCloseMetadataPanel,
}: NotesLayoutProps) {
  const isZenMode = useAppSelector((state) => state.zenMode.isActive);
  const { isMobile, isMobileOrTablet } = useBreakpoint();
  const [defaultLayout] = useState(() => loadPanelLayout('notes'));

  const handleLayoutChange = useCallback((layout: Record<string, number>) => {
    savePanelLayout('notes', layout);
  }, []);

  // On mobile: sidebar and metadata are both drawers, editor is full width
  // On tablet: sidebar is inline (narrower), metadata is drawer
  // On desktop: all panels inline and resizable
  const sidebarAsDrawer = isMobile;
  const metadataAsDrawer = isMobileOrTablet;

  return (
    <div
      className={cn(
        "bg-background overflow-hidden transition-[height] duration-300 ease-in-out",
        isZenMode ? "h-dvh delay-150" : "h-[calc(100dvh-4rem)] delay-0"
      )}
    >
      <Group
        orientation="horizontal"
        className="h-full w-full flex"
        defaultLayout={defaultLayout}
        onLayoutChange={handleLayoutChange}
      >
        {/* Left Sidebar - inline on tablet+, drawer on mobile */}
        {showSidebar && !sidebarAsDrawer && (
          <>
            <Panel
              id="notes-sidebar"
              defaultSize={isMobileOrTablet ? 200 : 280}
              minSize={160}
              maxSize={isMobileOrTablet ? 300 : 500}
              className="bg-card overflow-hidden"
            >
              {sidebar}
            </Panel>

            <Separator className="w-1 bg-border hover:bg-primary/50 transition-colors cursor-col-resize data-[resize-handle-state=drag]:bg-primary" />
          </>
        )}

        {/* Main Editor Area */}
        <Panel id="notes-editor" minSize={isMobileOrTablet ? 200 : 400}>
          <div className="h-full overflow-hidden bg-card">
            {editor}
          </div>
        </Panel>

        {/* Right Metadata Panel - inline on desktop, drawer on tablet/mobile */}
        {showMetadataPanel && metadataPanel && !metadataAsDrawer && (
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

      {/* Mobile sidebar drawer */}
      {sidebarAsDrawer && (
        <Drawer
          open={showSidebar}
          onClose={onCloseSidebar ?? (() => {})}
          side="left"
          className="w-72"
          ariaLabel="Notes sidebar"
        >
          {sidebar}
        </Drawer>
      )}

      {/* Tablet/mobile metadata drawer */}
      {metadataAsDrawer && (
        <Drawer
          open={showMetadataPanel && !!metadataPanel}
          onClose={onCloseMetadataPanel ?? (() => {})}
          side="right"
          className="w-80"
          showClose={false}
          ariaLabel="Note details"
        >
          {metadataPanel}
        </Drawer>
      )}
    </div>
  );
}
