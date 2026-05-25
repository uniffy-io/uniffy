import { ClipboardText } from '@phosphor-icons/react';
import { useDocumentTitle } from '@/shared/hooks/useDocumentTitle';
import { PlatformPagePlaceholder } from '@/features/platform/components/PlatformPagePlaceholder';

export function PlatformAuditPage() {
    useDocumentTitle('Platform Audit');
    return (
        <PlatformPagePlaceholder
            icon={ClipboardText}
            title="Audit"
            description="Platform-scope audit feed: auth, organization lifecycle, support sessions, system events. Tenant content audit is excluded by design."
        />
    );
}
