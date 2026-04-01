/**
 * Domain Admins Page
 *
 * Domain admin management page.
 * Wraps the DomainAdminsSection component for use as a routed page.
 */

import { DomainAdminsSection } from '@/features/admin/components/domain-admins/DomainAdminsSection';
import { useDocumentTitle } from '@/shared/hooks/useDocumentTitle';

export function DomainAdminsPage() {
    useDocumentTitle('Domain Admins');
    return <DomainAdminsSection />;
}
