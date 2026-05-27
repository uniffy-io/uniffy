import { GroupsSection } from '@/features/admin/components/groups/GroupsSection';
import { useDocumentTitle } from '@/shared/hooks/useDocumentTitle';

export function GroupsPage() {
    useDocumentTitle('Groups');
    return <GroupsSection />;
}
