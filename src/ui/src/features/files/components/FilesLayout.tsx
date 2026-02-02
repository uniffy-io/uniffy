/**
 * Files Layout Component
 *
 * Three-panel layout with resizable sidebar and main content area.
 * Follows the same pattern as NotesLayout.
 */

import { type ReactNode, useState, useCallback } from 'react';
import { Panel, Group, Separator } from 'react-resizable-panels';
import { CaretDoubleRight } from '@phosphor-icons/react';
import { useAppSelector } from '@/app/hooks';
import { cn } from '@/utils/cn';
import { loadPanelLayout, savePanelLayout } from '@/utils/panelStorage';

interface FilesLayoutProps {
    sidebar: ReactNode;
    content: ReactNode;
    detailPanel?: ReactNode;
    showSidebar?: boolean;
    showDetailPanel?: boolean;
    onToggleSidebar?: () => void;
}

export function FilesLayout({
    sidebar,
    content,
    detailPanel,
    showSidebar = true,
    showDetailPanel = false,
    onToggleSidebar,
}: FilesLayoutProps) {
    const isZenMode = useAppSelector((state) => state.zenMode.isActive);
    const [defaultLayout] = useState(() => loadPanelLayout('files'));

    const handleLayoutChange = useCallback((layout: Record<string, number>) => {
        savePanelLayout('files', layout);
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
                {/* Collapsed sidebar toggle (shown when sidebar is hidden) */}
                {!showSidebar && onToggleSidebar && (
                    <div className="flex flex-col items-center py-3 px-1 bg-card border-r border-border">
                        <button
                            onClick={onToggleSidebar}
                            className="p-1.5 rounded-md bg-transparent hover:bg-muted transition-colors"
                            title="Show sidebar"
                        >
                            <CaretDoubleRight size={16} weight="bold" className="text-primary" />
                        </button>
                    </div>
                )}

                {/* Left Sidebar */}
                {showSidebar && (
                    <>
                        <Panel
                            id="files-sidebar"
                            defaultSize={260}
                            minSize={200}
                            maxSize={400}
                            className="bg-card overflow-hidden"
                        >
                            {sidebar}
                        </Panel>

                        <Separator className="w-1 bg-border hover:bg-primary/50 transition-colors cursor-col-resize data-[resize-handle-state=drag]:bg-primary" />
                    </>
                )}

                {/* Main Content Area */}
                <Panel id="files-content" minSize={400}>
                    <div className="h-full overflow-hidden bg-card">
                        {content}
                    </div>
                </Panel>

                {/* Right Detail Panel (for file preview) */}
                {showDetailPanel && detailPanel && (
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
        </div>
    );
}
