import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { GroupsManagement } from "../components/GroupsManagement";
import { useAppSelector } from "@/app/hooks";

export default function OrgSettingsPage() {
  useDocumentTitle('Organization Settings');
  const { currentOrganizationId } = useAppSelector((state) => state.auth);

  if (!currentOrganizationId) {
      return (
          <div className="flex flex-col items-center justify-center min-h-[50vh] text-center">
              <h1 className="text-2xl font-bold mb-2">Organization Settings</h1>
              <p className="text-muted-foreground">Please select an organization to view its settings.</p>
          </div>
      );
  }

  return (
    <div className="container mx-auto py-6 px-4 space-y-8">
      <div className="flex justify-between items-center border-b pb-4">
        <h1 className="text-2xl font-bold tracking-tight">Organization Settings</h1>
      </div>

      <section>
        <GroupsManagement />
      </section>

      {/* Future sections: Members, Roles, Billing, etc. */}
    </div>
  );
}
