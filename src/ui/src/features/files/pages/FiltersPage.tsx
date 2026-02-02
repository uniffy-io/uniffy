/**
 * Filters Page Component
 *
 * Page for managing saved file filters.
 */

import { useAppSelector } from '@/app/hooks';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { AppHeader } from '@/components/layout/AppHeader';
import { FilesLayout } from '../components/FilesLayout';
import { FilesSidebar } from '../components/sidebar/FilesSidebar';
import { FiltersDashboard } from '../components/filters';
import { cn } from '@/utils/cn';

export function FiltersPage() {
    useDocumentTitle('Filters');

    const isZenMode = useAppSelector((state) => state.zenMode.isActive);

    return (
        <>
            <AppHeader />
            <FilesLayout
                showSidebar={!isZenMode}
                sidebar={<FilesSidebar />}
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

export default FiltersPage;
