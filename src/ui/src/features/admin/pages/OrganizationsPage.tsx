import { useState, useEffect } from 'react';
import { createClient } from "@connectrpc/connect";
import { AuthService } from "@/gen/auth/v1/auth_connect";
import { AdminOrganizationInfo } from "@/gen/auth/v1/auth_pb";
import { useAppSelector } from "@/app/hooks";
import { Button } from "@/components/ui/button";
import { OrganizationEditDialog } from "../components/OrganizationEditDialog";
import { transport } from "@/config";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { BuildingOfficeIcon, PlusIcon, PencilSquareIcon, ClipboardDocumentIcon, CheckIcon } from '@heroicons/react/24/outline';
import { cn } from "@/utils/cn";

export default function OrganizationsPage() {
  useDocumentTitle('Organizations');
  const [organizations, setOrganizations] = useState<AdminOrganizationInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [selectedOrg, setSelectedOrg] = useState<AdminOrganizationInfo | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  
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

  const handleCopyId = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    e.preventDefault();
    
    try {
      const textArea = document.createElement('textarea');
      textArea.value = id;
      textArea.style.position = 'fixed';
      textArea.style.left = '-999999px';
      textArea.style.top = '0';
      document.body.appendChild(textArea);
      textArea.focus();
      textArea.select();
      
      const successful = document.execCommand('copy');
      document.body.removeChild(textArea);
      
      if (successful) {
        setCopiedId(id);
        setTimeout(() => setCopiedId(null), 2000);
      }
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  return (
    <div className="space-y-8 pb-12">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="rounded-xl bg-primary p-3 shadow-lg">
            <BuildingOfficeIcon className="h-7 w-7 text-primary-foreground" />
          </div>
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Organizations</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Manage all organizations in the system
            </p>
          </div>
        </div>
        <Button size="md" onClick={handleCreate}>
          <PlusIcon className="h-4 w-4" />
          Add Organization
        </Button>
      </div>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 dark:bg-red-950/20 dark:border-red-900/30 p-4">
          <p className="text-sm text-red-800 dark:text-red-400">{error}</p>
        </div>
      )}

      {/* Organizations Table */}
      <div className="rounded-xl border border-border bg-card shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/50">
                <th className="px-6 py-4 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">Name</th>
                <th className="px-6 py-4 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">Slug</th>
                <th className="px-6 py-4 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">Domain</th>
                <th className="px-6 py-4 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">Plan</th>
                <th className="px-6 py-4 text-center text-xs font-semibold text-muted-foreground uppercase tracking-wider">Members</th>
                <th className="px-6 py-4 text-center text-xs font-semibold text-muted-foreground uppercase tracking-wider">Status</th>
                <th className="px-6 py-4 text-right text-xs font-semibold text-muted-foreground uppercase tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {loading ? (
                <tr>
                  <td colSpan={7} className="px-6 py-12 text-center">
                    <div className="flex flex-col items-center gap-2">
                      <div className="h-8 w-8 animate-spin rounded-full border-4 border-muted border-t-primary"></div>
                      <p className="text-sm text-muted-foreground">Loading organizations...</p>
                    </div>
                  </td>
                </tr>
              ) : organizations.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-6 py-12 text-center">
                    <div className="flex flex-col items-center gap-2">
                      <BuildingOfficeIcon className="h-12 w-12 text-muted-foreground/50" />
                      <p className="text-sm font-medium text-foreground">No organizations found</p>
                      <p className="text-xs text-muted-foreground">Create your first organization to get started</p>
                    </div>
                  </td>
                </tr>
              ) : (
                organizations.map((org) => (
                  <tr 
                    key={org.id} 
                    className="group hover:bg-accent/50 transition-colors"
                  >
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        <div className="h-10 w-10 rounded-lg bg-gradient-to-br from-blue-500/20 to-blue-600/20 flex items-center justify-center border border-blue-500/30">
                          <BuildingOfficeIcon className="h-5 w-5 text-blue-600 dark:text-blue-400" />
                        </div>
                        <div>
                          <div className="font-semibold text-foreground">{org.name}</div>
                          <div className="flex items-center gap-1.5 group/copy">
                            <span className="text-xs text-muted-foreground font-mono">{org.id.slice(0, 8)}...</span>
                            <button
                              type="button"
                              onClick={(e) => handleCopyId(e, org.id)}
                              className="opacity-0 group-hover:opacity-100 group-hover/copy:opacity-100 rounded p-0.5 hover:bg-accent transition-all relative z-10"
                              title="Copy full UUID"
                            >
                              {copiedId === org.id ? (
                                <CheckIcon className="h-3 w-3 text-green-600 dark:text-green-400" />
                              ) : (
                                <ClipboardDocumentIcon className="h-3 w-3 text-muted-foreground hover:text-foreground" />
                              )}
                            </button>
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <code className="px-2 py-1 rounded bg-muted text-xs font-mono">{org.slug}</code>
                    </td>
                    <td className="px-6 py-4 text-muted-foreground">{org.domain || '-'}</td>
                    <td className="px-6 py-4">
                      <span className={cn(
                        "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold capitalize",
                        org.plan === 'enterprise' && "bg-gradient-to-r from-purple-100 to-purple-200 text-purple-700 dark:from-purple-950 dark:to-purple-900 dark:text-purple-300",
                        org.plan === 'pro' && "bg-gradient-to-r from-blue-100 to-blue-200 text-blue-700 dark:from-blue-950 dark:to-blue-900 dark:text-blue-300",
                        org.plan === 'free' && "bg-muted text-muted-foreground"
                      )}>
                        {org.plan}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-center">
                      <span className="inline-flex items-center justify-center h-7 w-7 rounded-full bg-primary/10 text-primary text-xs font-semibold">
                        {org.memberCount}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-center">
                      <div className="flex items-center justify-center gap-2">
                        <span className={cn(
                          "h-2 w-2 rounded-full animate-pulse",
                          org.isActive ? "bg-green-500" : "bg-red-500"
                        )} />
                        <span className={cn(
                          "text-xs font-medium",
                          org.isActive ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"
                        )}>
                          {org.isActive ? 'Active' : 'Inactive'}
                        </span>
                      </div>
                    </td>
                    <td className="px-6 py-4 text-right">
                      <Button 
                        variant="ghost" 
                        size="xs" 
                        onClick={(e) => {
                          e.stopPropagation();
                          handleEdit(org);
                        }}
                        className="opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        <PencilSquareIcon className="h-3.5 w-3.5" />
                        Edit
                      </Button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
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
