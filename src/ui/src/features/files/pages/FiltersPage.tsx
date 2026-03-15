/**
 * Filters Page Component
 *
 * Page for managing saved file filters.
 */

import { useState, useCallback } from 'react';
import { useAppSelector } from '@/app/hooks';
import { useDocumentTitle } from '@/shared/hooks/useDocumentTitle';
import { AppHeader } from '@/components/layout/AppHeader';
import { FilesLayout } from '@/features/files/components/FilesLayout';
import { FilesSidebar } from '@/features/files/components/sidebar/FilesSidebar';
import { FiltersDashboard } from '@/features/files/components/filters';
import { cn } from '@/shared/utils/cn';

export function FiltersPage() {
    useDocumentTitle('Filters');

    const isZenMode = useAppSelector((state) => state.zenMode.isActive);
    const [showSidebar, setShowSidebar] = useState(true);

    const handleToggleSidebar = useCallback(() => {
        setShowSidebar((prev) => !prev);
    }, []);

    const handleCloseSidebar = useCallback(() => {
        setShowSidebar(false);
    }, []);

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

