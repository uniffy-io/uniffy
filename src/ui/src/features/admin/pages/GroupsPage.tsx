/**
 * Groups Page
 *
 * Organization groups management page.
 * Wraps the GroupsSection component for use as a routed page.
 */

import { GroupsSection } from '../components/groups/GroupsSection';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';

export default function GroupsPage() {
    useDocumentTitle('Groups - Administration');
    return <GroupsSection />;
}
