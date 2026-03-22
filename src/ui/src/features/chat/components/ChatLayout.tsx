/**
 * ChatLayout - Main 3-panel layout for the Chat feature.
 *
 * Structure:
 * - Left sidebar: channel list, DMs, threads link
 * - Center: active channel view (messages + compose), or split 50/50 with secondary channel
 * - Right panel: thread panel OR resource panel (mutex, hidden during split)
 *
 * Responsive:
 * - Desktop (1024px+): all panels inline and resizable
 * - Tablet (768-1024px): sidebar as collapsible rail, RHS as drawer
 * - Mobile (<768px): sidebar as drawer, RHS as full-screen drawer
 *
 * Supports Zen Mode, persistent panel sizes, collapsed sidebar rail.
 */

import { type ReactNode, useState, useCallback } from 'react';
import { Panel, Group, Separator } from 'react-resizable-panels';
import {
  ChatTeardrop,
  Hash,
  ChatsCircle,
  Bell,
} from '@phosphor-icons/react';
import { useAppSelector, useAppDispatch } from '@/app/hooks';
import { cn } from '@/shared/utils/cn';
import { loadPanelLayout, savePanelLayout } from '@/shared/utils/panelStorage';
import { useBreakpoint } from '@/shared/hooks/useBreakpoint';
import { Drawer } from '@/components/ui/drawer';
import {
  expandSidebar,
  setSidebarOpen,
  closeThreadPanel,
  closeResourcePanel,
} from '@/features/chat/store/chatUiSlice';
import {
  CollapsibleSidebarRail,
  type SidebarSection,
} from '@/components/layout/CollapsibleSidebarRail';

const CHAT_SECTIONS: SidebarSection[] = [
  { id: 'threads', icon: ChatsCircle, label: 'Threads' },
  { id: 'channels', icon: Hash, label: 'Channels' },
  { id: 'dms', icon: ChatTeardrop, label: 'Messages' },
  { id: 'notifications', icon: Bell, label: 'Notifications' },
];

interface ChatLayoutProps {
  sidebar: ReactNode;
  channelView: ReactNode;
  splitView?: ReactNode;
  rightPanel?: ReactNode;
}

export function ChatLayout({
  sidebar,
  channelView,
  splitView,
  rightPanel,
}: ChatLayoutProps) {
  const dispatch = useAppDispatch();
  const isZenMode = useAppSelector((state) => state.zenMode.isActive);
  const sidebarOpen = useAppSelector((state) => state.chatUi.sidebarOpen);
  const threadPanelOpen = useAppSelector((state) => state.chatUi.threadPanelOpen);
  const resourcePanelOpen = useAppSelector((state) => state.chatUi.resourcePanelOpen);
  const splitActive = useAppSelector((state) => state.chatUi.splitActive);
  const splitChannelId = useAppSelector((state) => state.chatChannels.splitChannelId);

  const { isMobile, isMobileOrTablet } = useBreakpoint();
  const [defaultLayout] = useState(() => loadPanelLayout('chat'));

  const handleLayoutChange = useCallback((layout: Record<string, number>) => {
    savePanelLayout('chat', layout);
  }, []);

  const handleExpandSidebar = useCallback(() => {
    dispatch(expandSidebar());
  }, [dispatch]);

  const handleCloseSidebar = useCallback(() => {
    dispatch(setSidebarOpen(false));
  }, [dispatch]);

  const handleCloseRightPanel = useCallback(() => {
    if (threadPanelOpen) {
      dispatch(closeThreadPanel());
    } else if (resourcePanelOpen) {
      dispatch(closeResourcePanel());
    }
  }, [dispatch, threadPanelOpen, resourcePanelOpen]);

  const showSidebar = !isZenMode && sidebarOpen;
  const showSplit = splitActive && !!splitChannelId && !isMobileOrTablet;
  const showRightPanel = (threadPanelOpen || resourcePanelOpen) && !!rightPanel;
  const sidebarAsDrawer = isMobile;
  // Right panel as drawer on tablet, mobile, split active, or zen mode
  const rightPanelAsDrawer = isMobileOrTablet || showSplit || isZenMode;
  const showCollapsedRail = !isZenMode && !showSidebar && !sidebarAsDrawer;

  return (
    <div
      className={cn(
        "relative bg-background overflow-hidden transition-[height] duration-300 ease-in-out",
        isZenMode ? "h-dvh delay-150" : "h-[calc(100dvh-3rem)] delay-0"
      )}
    >
      {/* Collapsed sidebar rail */}
      {showCollapsedRail && (
        <div className="absolute inset-y-0 left-0 z-30 w-12">
          <CollapsibleSidebarRail
            onExpand={handleExpandSidebar}
            sections={CHAT_SECTIONS}
          >
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
        {/* Left Sidebar - inline on tablet+, drawer on mobile */}
        {showSidebar && !sidebarAsDrawer && (
          <>
            <Panel
              id="chat-sidebar"
              defaultSize={isMobileOrTablet ? 200 : 260}
              minSize={180}
              maxSize={isMobileOrTablet ? 280 : 320}
              className="bg-card overflow-hidden"
            >
              {sidebar}
            </Panel>

            <Separator className="w-1 bg-border hover:bg-primary/50 transition-colors cursor-col-resize data-[resize-handle-state=drag]:bg-primary" />
          </>
        )}

        {/* Main Channel View */}
        <Panel id="chat-channel" minSize={isMobileOrTablet ? 200 : 400}>
          <div className={cn("h-full overflow-hidden bg-background", showCollapsedRail && "ml-12")}>
            {showSplit && splitView ? (
              <div className="flex h-full">
                <div className="flex-1 min-w-0 overflow-hidden">
                  {channelView}
                </div>
                <div className="w-1 bg-border hover:bg-primary/50 transition-colors cursor-col-resize" />
                <div className="flex-1 min-w-0 overflow-hidden">
                  {splitView}
                </div>
              </div>
            ) : (
              channelView
            )}
          </div>
        </Panel>

        {/* Right Panel (Thread or Resources) - inline on desktop, drawer on tablet/mobile */}
        {showRightPanel && !rightPanelAsDrawer && (
          <>
            <Separator className="w-1 bg-border hover:bg-primary/50 transition-colors cursor-col-resize data-[resize-handle-state=drag]:bg-primary" />
            <Panel
              id="chat-right-panel"
              defaultSize={360}
              minSize={320}
              maxSize={500}
              className="bg-card overflow-hidden"
            >
              {rightPanel}
            </Panel>
          </>
        )}
      </Group>

      {/* Mobile sidebar drawer */}
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

      {/* Tablet/mobile right panel drawer */}
      {rightPanelAsDrawer && (
        <Drawer
          open={showRightPanel}
          onClose={handleCloseRightPanel}
          side="right"
          className="w-80"
          showClose={false}
          ariaLabel="Thread panel"
        >
          {rightPanel}
        </Drawer>
      )}
    </div>
  );
}
