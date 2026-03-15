/**
 * Members Page
 *
 * Organization members management page.
 * Wraps the MembersSection component for use as a routed page.
 */

import { MembersSection } from '@/features/admin/components/members/MembersSection';
import { useDocumentTitle } from '@/shared/hooks/useDocumentTitle';

export function MembersPage() {
    useDocumentTitle('Members');
    return <MembersSection />;
}
