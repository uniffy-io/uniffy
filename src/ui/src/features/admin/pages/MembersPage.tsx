/**
 * Members Page
 *
 * Organization members management page.
 * Wraps the MembersSection component for use as a routed page.
 */

import { MembersSection } from '../components/members/MembersSection';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';

export default function MembersPage() {
    useDocumentTitle('Members');
    return <MembersSection />;
}
