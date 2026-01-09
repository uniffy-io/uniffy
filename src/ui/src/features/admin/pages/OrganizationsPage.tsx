import { useState, useEffect } from 'react';
import { createClient } from "@connectrpc/connect";
import { AuthService } from "@/gen/auth/v1/auth_connect";
import { AdminOrganizationInfo } from "@/gen/auth/v1/auth_pb";
import { useAppSelector } from "@/app/hooks";
import { Button } from "@/components/ui/button";
import { OrganizationEditDialog } from "../components/OrganizationEditDialog";
import { transport } from "@/config";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";

export default function OrganizationsPage() {
  useDocumentTitle('Organizations');
  const [organizations, setOrganizations] = useState<AdminOrganizationInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [selectedOrg, setSelectedOrg] = useState<AdminOrganizationInfo | null>(null);
  
  const { accessToken } = useAppSelector((state) => state.auth);

  useEffect(() => {
    fetchOrganizations();
  }, [accessToken]);

  const fetchOrganizations = async () => {
    if (!accessToken) return;
    setLoading(true);
    try {
      const client = createClient(AuthService, transport);
      const response = await client.listAllOrganizations(
        { page: 1, pageSize: 100 }, // Fetch all for now
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );
      setOrganizations(response.organizations);
    } catch (err: any) {
      console.error('Failed to list organizations:', err);
      setError('Failed to load organizations');
    } finally {
      setLoading(false);
    }
  };

  const handleCreate = () => {
    setSelectedOrg(null);
    setIsDialogOpen(true);
  };

  const handleEdit = (org: AdminOrganizationInfo) => {
    setSelectedOrg(org);
    setIsDialogOpen(true);
  };

  const handleClose = () => {
    setIsDialogOpen(false);
    setSelectedOrg(null);
  };

  const handleSave = () => {
    fetchOrganizations();
    handleClose();
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold tracking-tight">Organizations</h1>
        <Button size="sm" onClick={handleCreate}>
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          Add Organization
        </Button>
      </div>

      {error && (
        <div className="bg-destructive/10 text-destructive p-4 rounded-md">
          {error}
        </div>
      )}

      <div className="border rounded-lg overflow-hidden">
        <table className="w-full text-sm text-left">
          <thead className="bg-muted text-muted-foreground uppercase font-medium">
            <tr>
              <th className="px-4 py-3">ID</th>
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3">Slug</th>
              <th className="px-4 py-3">Domain</th>
              <th className="px-4 py-3">Plan</th>
              <th className="px-4 py-3 text-center">Members</th>
              <th className="px-4 py-3 text-center">Status</th>
              <th className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border bg-card">
            {loading ? (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-muted-foreground">
                  Loading...
                </td>
              </tr>
            ) : organizations.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-muted-foreground">
                  No organizations found
                </td>
              </tr>
            ) : (
              organizations.map((org) => (
                <tr key={org.id} className="hover:bg-accent/50 transition-colors">
                  <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{org.id}</td>
                  <td className="px-4 py-3 font-medium">{org.name}</td>
                  <td className="px-4 py-3 text-muted-foreground">{org.slug}</td>
                  <td className="px-4 py-3 text-muted-foreground">{org.domain || '-'}</td>
                  <td className="px-4 py-3">
                    <span className="inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 border-transparent bg-secondary text-secondary-foreground hover:bg-secondary/80 capitalize">
                      {org.plan}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-center">{org.memberCount}</td>
                  <td className="px-4 py-3 text-center">
                    <span className={`inline-block w-2 h-2 rounded-full ${org.isActive ? 'bg-green-500' : 'bg-red-500'}`} title={org.isActive ? 'Active' : 'Inactive'} />
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Button variant="ghost" size="xs" onClick={() => handleEdit(org)}>
                      <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                      </svg>
                      Edit
                    </Button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <OrganizationEditDialog
        org={selectedOrg}
        isOpen={isDialogOpen}
        onClose={handleClose}
        onSave={handleSave}
      />
    </div>
  );
}
