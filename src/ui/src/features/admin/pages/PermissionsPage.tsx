/**
 * Permissions Page
 *
 * Organization permission defaults management page.
 * Wraps the PermissionDefaultsSection component for use as a routed page.
 */

import { PermissionDefaultsSection } from '../components/permissions/PermissionDefaultsSection';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';

export default function PermissionsPage() {
    useDocumentTitle('Permissions - Administration');
    return <PermissionDefaultsSection />;
}
