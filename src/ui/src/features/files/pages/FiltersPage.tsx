/**
 * Filters Page Component
 *
 * Page for managing saved file filters.
 */

import { useCallback } from 'react';
import { useAppDispatch, useAppSelector } from '@/app/hooks';
import { useDocumentTitle } from '@/shared/hooks/useDocumentTitle';
import { AppHeader } from '@/components/layout/AppHeader';
import { FilesLayout } from '@/features/files/components/FilesLayout';
import { FilesSidebar } from '@/features/files/components/sidebar/FilesSidebar';
import { FiltersDashboard } from '@/features/files/components/filters';
import { toggleSidebar } from '@/features/files/store/filesSlice';
import { cn } from '@/shared/utils/cn';

export function FiltersPage() {
    useDocumentTitle('Filters');

    const dispatch = useAppDispatch();
    const isZenMode = useAppSelector((state) => state.zenMode.isActive);
    const showSidebar = useAppSelector((state) => state.files.sidebarOpen);

    const handleToggleSidebar = useCallback(() => {
        dispatch(toggleSidebar());
    }, [dispatch]);

    const handleCloseSidebar = useCallback(() => {
        if (showSidebar) dispatch(toggleSidebar());
    }, [dispatch, showSidebar]);

    return (
        <>
            <AppHeader />
            <FilesLayout
                showSidebar={!isZenMode && showSidebar}
                onToggleSidebar={handleToggleSidebar}
                onCloseSidebar={handleCloseSidebar}
                sidebar={<FilesSidebar onToggleSidebar={handleToggleSidebar} />}
                content={
                    <div className="h-full overflow-y-auto">
                        <div className={cn(
                            "p-6",
                            "max-w-6xl mx-auto"
                        )}>
                            <FiltersDashboard />
                        </div>
                    </div>
                }
            />
        </>
    );
}

