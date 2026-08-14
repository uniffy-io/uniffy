import { type ReactNode, useState, useCallback } from "react";
import { Panel, Group, Separator } from "react-resizable-panels";
import { BookmarkSimple, LockSimple, UsersThree, Buildings } from "@phosphor-icons/react";
import { useAppSelector, useAppDispatch } from "@/app/hooks";
import { cn } from "@/shared/utils/cn";
import { loadPanelLayout, savePanelLayout } from "@/shared/utils/panelStorage";
import { useBreakpoint } from "@/shared/hooks/useBreakpoint";
import { Drawer } from "@/components/ui/drawer";
import { toggleSidebar } from "@/features/notes/store/editorSlice";
import {
  CollapsibleSidebarRail,
  type SidebarSection,
} from "@/components/layout/CollapsibleSidebarRail";

const NOTES_SECTIONS: SidebarSection[] = [
  { id: "bookmarked", icon: BookmarkSimple, label: "Bookmarks" },
  { id: "personal", icon: LockSimple, label: "Personal" },
  { id: "shared", icon: UsersThree, label: "Shared" },
  { id: "organization", icon: Buildings, label: "Organization" },
];

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
  const dispatch = useAppDispatch();
  const isZenMode = useAppSelector((state) => state.zenMode.isActive);
  const { isMobile, isMobileOrTablet } = useBreakpoint();
  const [defaultLayout] = useState(() => loadPanelLayout("notes"));

  const handleLayoutChange = useCallback((layout: Record<string, number>) => {
    savePanelLayout("notes", layout);
  }, []);

  const handleExpandSidebar = useCallback(() => {
    dispatch(toggleSidebar());
  }, [dispatch]);

  const sidebarAsDrawer = isMobile;
  const metadataAsDrawer = isMobileOrTablet;
  const showCollapsedRail = !isZenMode && !showSidebar && !sidebarAsDrawer;

  return (
    <div
      className={cn(
        "relative bg-background overflow-hidden transition-[height] duration-300 ease-in-out",
        isZenMode ? "h-dvh delay-150" : "h-[calc(100dvh-3rem)] delay-0",
      )}
    >
      {showCollapsedRail && (
        <div className="absolute inset-y-0 left-0 z-30 w-12">
          <CollapsibleSidebarRail onExpand={handleExpandSidebar} sections={NOTES_SECTIONS}>
            {sidebar}
          </CollapsibleSidebarRail>
        </div>
      )}

      <Group
        orientation="horizontal"
        className="h-full w-full flex"
        defaultLayout={defaultLayout}
        onLayoutChange={handleLayoutChange}
      >
        {showSidebar && !sidebarAsDrawer && (
          <>
            <Panel
              id="notes-sidebar"
              defaultSize={isMobileOrTablet ? 200 : 280}
              minSize={160}
              maxSize={isMobileOrTablet ? 300 : 500}
              className="bg-background overflow-hidden"
            >
              {sidebar}
            </Panel>

            <Separator className="w-1 bg-border hover:bg-primary/50 transition-colors cursor-col-resize data-[resize-handle-state=drag]:bg-primary" />
          </>
        )}

        <Panel id="notes-editor" minSize={isMobileOrTablet ? 200 : 400}>
          <div className={cn("h-full overflow-hidden bg-card", showCollapsedRail && "ml-12")}>
            {editor}
          </div>
        </Panel>

        {showMetadataPanel && metadataPanel && !metadataAsDrawer && (
          <>
            <Separator className="w-1 bg-border hover:bg-primary/50 transition-colors cursor-col-resize data-[resize-handle-state=drag]:bg-primary" />
            <Panel
              id="notes-metadata"
              defaultSize={300}
              minSize={200}
              maxSize={400}
              className="bg-background overflow-hidden"
            >
              {metadataPanel}
            </Panel>
          </>
        )}
      </Group>

      {sidebarAsDrawer && (
        <Drawer
          open={showSidebar}
          onClose={onCloseSidebar ?? (() => {})}
          side="left"
          className="w-72 bg-background"
          ariaLabel="Notes sidebar"
        >
          {sidebar}
        </Drawer>
      )}

      {metadataAsDrawer && (
        <Drawer
          open={showMetadataPanel && !!metadataPanel}
          onClose={onCloseMetadataPanel ?? (() => {})}
          side="right"
          className="w-80 bg-background"
          showClose={false}
          ariaLabel="Note details"
        >
          {metadataPanel}
        </Drawer>
      )}
    </div>
  );
}
