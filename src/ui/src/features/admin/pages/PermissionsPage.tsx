/**
 * Permissions Page
 *
 * Organization permission defaults management page.
 * Wraps the PermissionDefaultsSection component for use as a routed page.
 */

import { PermissionDefaultsSection } from '@/features/admin/components/permissions/PermissionDefaultsSection';
import { useDocumentTitle } from '@/shared/hooks/useDocumentTitle';

export default function PermissionsPage() {
    useDocumentTitle('Permissions');
    return <PermissionDefaultsSection />;
}
