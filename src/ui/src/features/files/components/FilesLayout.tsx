/**
 * Files Layout Component
 *
 * Responsive three-panel layout with resizable sidebar and main content area.
 * Collapsed sidebar shows an icon rail with hover-to-expand overlay.
 *
 * Mobile: sidebar and detail panel as drawers, content full width.
 * Tablet: sidebar inline (narrower), detail panel as drawer.
 * Desktop: all panels inline and resizable.
 */

import { type ReactNode, useState, useCallback } from 'react';
import { Panel, Group, Separator } from 'react-resizable-panels';
import {
    SquaresFour,
    BookmarkSimple,
    LockSimple,
    Buildings,
} from '@phosphor-icons/react';
import { useAppSelector } from '@/app/hooks';
import { cn } from '@/shared/utils/cn';
import { loadPanelLayout, savePanelLayout } from '@/shared/utils/panelStorage';
import { useBreakpoint } from '@/shared/hooks/useBreakpoint';
import { Drawer } from '@/components/ui/drawer';
import {
    CollapsibleSidebarRail,
    type SidebarSection,
} from '@/components/layout/CollapsibleSidebarRail';

const FILES_SECTIONS: SidebarSection[] = [
    { id: 'all', icon: SquaresFour, label: 'All Files' },
    { id: 'bookmarked', icon: BookmarkSimple, label: 'Bookmarks' },
    { id: 'personal', icon: LockSimple, label: 'Personal' },
    { id: 'organization', icon: Buildings, label: 'Organization' },
];

interface FilesLayoutProps {
    sidebar: ReactNode;
    content: ReactNode;
    detailPanel?: ReactNode;
    showSidebar?: boolean;
    showDetailPanel?: boolean;
    onToggleSidebar?: () => void;
    onCloseSidebar?: () => void;
    onCloseDetailPanel?: () => void;
}

export function FilesLayout({
    sidebar,
    content,
    detailPanel,
    showSidebar = true,
    showDetailPanel = false,
    onToggleSidebar,
    onCloseSidebar,
    onCloseDetailPanel,
}: FilesLayoutProps) {
    const isZenMode = useAppSelector((state) => state.zenMode.isActive);
    const { isMobile, isMobileOrTablet } = useBreakpoint();
    const [defaultLayout] = useState(() => loadPanelLayout('files'));

    const handleLayoutChange = useCallback((layout: Record<string, number>) => {
        savePanelLayout('files', layout);
    }, []);

    // On mobile: sidebar and detail are both drawers, content is full width
    // On tablet: sidebar is inline (narrower), detail is drawer
    // On desktop: all panels inline and resizable
    const sidebarAsDrawer = isMobile;
    const detailAsDrawer = isMobileOrTablet;
    const showCollapsedRail = !isZenMode && !showSidebar && onToggleSidebar && !sidebarAsDrawer;

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
                        onExpand={onToggleSidebar}
                        sections={FILES_SECTIONS}
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
                            id="files-sidebar"
                            defaultSize={isMobileOrTablet ? 200 : 260}
                            minSize={160}
                            maxSize={isMobileOrTablet ? 300 : 400}
                            className="bg-background overflow-hidden"
                        >
                            {sidebar}
                        </Panel>

                        <Separator className="w-1 bg-border hover:bg-primary/50 transition-colors cursor-col-resize data-[resize-handle-state=drag]:bg-primary" />
                    </>
                )}

                {/* Main Content Area */}
                <Panel id="files-content" minSize={isMobileOrTablet ? 200 : 400}>
                    <div className={cn("h-full overflow-hidden bg-card", showCollapsedRail && "ml-12")}>
                        {content}
                    </div>
                </Panel>

                {/* Right Detail Panel - inline on desktop, drawer on tablet/mobile */}
                {showDetailPanel && detailPanel && !detailAsDrawer && (
                    <>
                        <Separator className="w-1 bg-border hover:bg-primary/50 transition-colors cursor-col-resize data-[resize-handle-state=drag]:bg-primary" />
                        <Panel
                            id="files-detail"
                            defaultSize={320}
                            minSize={240}
                            maxSize={480}
                            className="bg-card overflow-hidden"
                        >
                            {detailPanel}
                        </Panel>
                    </>
                )}
            </Group>

            {/* Mobile sidebar drawer */}
            {sidebarAsDrawer && (
                <Drawer
                    open={showSidebar}
                    onClose={onCloseSidebar ?? (() => { })}
                    side="left"
                    className="w-72"
                    ariaLabel="Files sidebar"
                >
                    {sidebar}
                </Drawer>
            )}

            {/* Tablet/mobile detail drawer */}
            {detailAsDrawer && (
                <Drawer
                    open={showDetailPanel && !!detailPanel}
                    onClose={onCloseDetailPanel ?? (() => { })}
                    side="right"
                    className="w-80"
                    showClose={false}
                    ariaLabel="File details"
                >
                    {detailPanel}
                </Drawer>
            )}
        </div>
    );
}
