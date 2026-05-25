import { Lifebuoy } from '@phosphor-icons/react';
import { useDocumentTitle } from '@/shared/hooks/useDocumentTitle';
import { PlatformPagePlaceholder } from '@/features/platform/components/PlatformPagePlaceholder';

export function PlatformSessionsPage() {
    useDocumentTitle('Support Sessions');
    return (
        <PlatformPagePlaceholder
            icon={Lifebuoy}
            title="Support sessions"
            description="Time-bound, audit-logged operator access into a tenant org. List of active and recent sessions across the deployment."
        />
    );
}
