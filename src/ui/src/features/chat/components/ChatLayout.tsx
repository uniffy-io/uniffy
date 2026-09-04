import { type ReactNode, useState, useCallback } from "react";
import { Panel, Group } from "react-resizable-panels";
import { PaneSeparator } from "@/components/ui/pane-separator";
import { ChatTeardrop, Hash, ChatsCircle, Bell } from "@phosphor-icons/react";
import { useAppSelector, useAppDispatch } from "@/app/hooks";
import { cn } from "@/shared/utils/cn";
import { loadPanelLayout, savePanelLayout } from "@/shared/utils/panelStorage";
import { useBreakpoint } from "@/shared/hooks/useBreakpoint";
import { Drawer } from "@/components/ui/drawer";
import { expandSidebar, setSidebarOpen } from "@/features/chat/store/chatUiSlice";
import {
  CollapsibleSidebarRail,
  type SidebarSection,
} from "@/components/layout/CollapsibleSidebarRail";

const CHAT_SECTIONS: SidebarSection[] = [
  { id: "threads", icon: ChatsCircle, label: "Threads" },
  { id: "channels", icon: Hash, label: "Channels" },
  { id: "dms", icon: ChatTeardrop, label: "Messages" },
  { id: "notifications", icon: Bell, label: "Notifications" },
];

export interface ChatRightPanel {
  node: ReactNode;
  /** Accessible name when the panel renders as a drawer. */
  label: string;
  onClose: () => void;
}

interface ChatLayoutProps {
  sidebar: ReactNode;
  channelView: ReactNode;
  splitView?: ReactNode;
  rightPanel?: ChatRightPanel | null;
}

export function ChatLayout({ sidebar, channelView, splitView, rightPanel }: ChatLayoutProps) {
  const dispatch = useAppDispatch();
  const isZenMode = useAppSelector((state) => state.zenMode.isActive);
  const sidebarOpen = useAppSelector((state) => state.chatUi.sidebarOpen);
  const splitActive = useAppSelector((state) => state.chatUi.splitActive);
  const splitChannelId = useAppSelector((state) => state.chatChannels.splitChannelId);

  const { isMobile, isMobileOrTablet } = useBreakpoint();
  const [defaultLayout] = useState(() => loadPanelLayout("chat"));

  const handleLayoutChange = useCallback((layout: Record<string, number>) => {
    savePanelLayout("chat", layout);
  }, []);

  const handleExpandSidebar = useCallback(() => {
    dispatch(expandSidebar());
  }, [dispatch]);

  const handleCloseSidebar = useCallback(() => {
    dispatch(setSidebarOpen(false));
  }, [dispatch]);

  const showSidebar = !isZenMode && sidebarOpen;
  const showSplit = splitActive && !!splitChannelId && !isMobileOrTablet;
  const showRightPanel = !!rightPanel;
  const sidebarAsDrawer = isMobile;
  const rightPanelAsDrawer = isMobileOrTablet || showSplit || isZenMode;
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
          <CollapsibleSidebarRail onExpand={handleExpandSidebar} sections={CHAT_SECTIONS}>
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
              id="chat-sidebar"
              defaultSize={isMobileOrTablet ? 200 : 260}
              minSize={180}
              maxSize={isMobileOrTablet ? 280 : 320}
              className="bg-nav overflow-hidden"
            >
              {sidebar}
            </Panel>

            <PaneSeparator />
          </>
        )}

        <Panel id="chat-channel" minSize={isMobileOrTablet ? 200 : 400}>
          <div className={cn("h-full overflow-hidden bg-surface", showCollapsedRail && "ml-12")}>
            <div className="flex h-full">
              <div className="flex-1 min-w-0 overflow-hidden">{channelView}</div>
              {showSplit && splitView ? (
                <>
                  <PaneSeparator static />
                  <div className="flex-1 min-w-0 overflow-hidden">{splitView}</div>
                </>
              ) : null}
            </div>
          </div>
        </Panel>

        {rightPanel && !rightPanelAsDrawer && (
          <>
            <PaneSeparator />
            <Panel
              id="chat-right-panel"
              defaultSize={720}
              minSize={320}
              maxSize={900}
              className="bg-background overflow-hidden"
            >
              {rightPanel.node}
            </Panel>
          </>
        )}
      </Group>

      {sidebarAsDrawer && (
        <Drawer
          open={showSidebar}
          onClose={handleCloseSidebar}
          side="left"
          className="w-72"
          ariaLabel="Chat sidebar"
        >
          {sidebar}
        </Drawer>
      )}

      {rightPanelAsDrawer && rightPanel && (
        <Drawer
          open={showRightPanel}
          onClose={rightPanel.onClose}
          side="right"
          className="w-80"
          showClose={false}
          ariaLabel={rightPanel.label}
        >
          {rightPanel.node}
        </Drawer>
      )}
    </div>
  );
}
