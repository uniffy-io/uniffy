/**
 * Groups Page
 *
 * Organization groups management page.
 * Wraps the GroupsSection component for use as a routed page.
 */

import { GroupsSection } from '@/features/admin/components/groups/GroupsSection';
import { useDocumentTitle } from '@/shared/hooks/useDocumentTitle';

export default function GroupsPage() {
    useDocumentTitle('Groups');
    return <GroupsSection />;
}
