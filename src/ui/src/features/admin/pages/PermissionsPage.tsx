import { PermissionDefaultsSection } from "@/features/admin/components/permissions/PermissionDefaultsSection";
import { useDocumentTitle } from "@/shared/hooks/useDocumentTitle";

export function PermissionsPage() {
  useDocumentTitle("Org Default Permissions");
  return <PermissionDefaultsSection />;
}
