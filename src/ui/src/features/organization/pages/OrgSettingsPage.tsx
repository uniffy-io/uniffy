import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { GroupsManagement } from "../components/GroupsManagement";
import { useAppSelector } from "@/app/hooks";
import { Cog6ToothIcon, BuildingOfficeIcon } from '@heroicons/react/24/outline';

export default function OrgSettingsPage() {
  useDocumentTitle('Organization Settings');
  const { currentOrganizationId } = useAppSelector((state) => state.auth);

  if (!currentOrganizationId) {
      return (
          <div className="flex flex-col items-center justify-center min-h-[50vh] text-center space-y-4">
              <div className="rounded-xl bg-gradient-to-br from-blue-500 to-blue-600 p-4 shadow-lg shadow-blue-500/25">
                <BuildingOfficeIcon className="h-12 w-12 text-white" />
              </div>
              <div>
                <h1 className="text-2xl font-bold mb-2">Organization Settings</h1>
                <p className="text-muted-foreground">Please select an organization to view its settings.</p>
              </div>
          </div>
      );
  }

  return (
    <div className="container mx-auto py-6 px-4 space-y-8">
      <div className="flex items-center gap-3">
        <div className="rounded-xl bg-primary p-3 shadow-lg">
          <Cog6ToothIcon className="h-7 w-7 text-primary-foreground" />
        </div>
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Organization Settings</h1>
          <p className="text-sm text-muted-foreground mt-1">Configure organization-wide settings and preferences</p>
        </div>
      </div>

      <section>
        <GroupsManagement />
      </section>

      {/* Future sections: Members, Roles, Billing, etc. */}
    </div>
  );
}
