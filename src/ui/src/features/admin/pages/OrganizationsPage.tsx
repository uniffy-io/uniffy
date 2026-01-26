import { useState, useEffect, useCallback } from 'react';
import { createClient } from "@connectrpc/connect";
import { OrganizationsService } from "@/gen/organizations/v1/organizations_connect";
import { OrganizationDetail } from "@/gen/organizations/v1/organizations_pb";
import { useAppSelector } from "@/app/hooks";
import { Button } from "@/components/ui/button";
import {
    Table,
    TableHeader,
    TableBody,
    TableRow,
    TableHead,
    TableCell,
    TableLoading,
    TableEmpty,
} from "@/components/ui/table";
import { OrganizationEditDialog } from "../components/OrganizationEditDialog";
import { transport } from "@/config";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { Buildings, Plus, PencilSimple, Clipboard, Check } from '@phosphor-icons/react';
import { cn } from "@/utils/cn";

export default function OrganizationsPage() {
  useDocumentTitle('Organizations');
  const [organizations, setOrganizations] = useState<OrganizationDetail[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [selectedOrg, setSelectedOrg] = useState<OrganizationDetail | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const { accessToken } = useAppSelector((state) => state.auth);

  const fetchOrganizations = useCallback(async () => {
    if (!accessToken) return;
    setLoading(true);
    try {
      const client = createClient(OrganizationsService, transport);
      const response = await client.listOrganizations(
        { pagination: { page: 1, pageSize: 100 } },
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );
      setOrganizations(response.organizations);
    } catch (err: unknown) {
      console.error('Failed to list organizations:', err);
      setError('Failed to load organizations');
    } finally {
      setLoading(false);
    }
  }, [accessToken]);

  useEffect(() => {
    fetchOrganizations();
  }, [fetchOrganizations]);

  const handleCreate = () => {
    setSelectedOrg(null);
    setIsDialogOpen(true);
  };

  const handleEdit = (org: OrganizationDetail) => {
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
            <Buildings size={28} weight="duotone" className="text-primary-foreground" />
          </div>
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Organizations</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Manage all organizations in the system
            </p>
          </div>
        </div>
        <Button size="md" onClick={handleCreate}>
          <Plus size={16} />
          Add Organization
        </Button>
      </div>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 dark:bg-red-950/20 dark:border-red-900/30 p-4">
          <p className="text-sm text-red-800 dark:text-red-400">{error}</p>
        </div>
      )}

      {/* Organizations Table */}
      <Table>
        <TableHeader>
          <TableRow hoverable={false}>
            <TableHead>Name</TableHead>
            <TableHead>Slug</TableHead>
            <TableHead>Domain</TableHead>
            <TableHead>Plan</TableHead>
            <TableHead align="center">Members</TableHead>
            <TableHead align="center">Status</TableHead>
            <TableHead align="right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {loading ? (
            <TableLoading colSpan={7} message="Loading organizations..." />
          ) : organizations.length === 0 ? (
            <TableEmpty
              colSpan={7}
              icon={<Buildings size={48} weight="duotone" />}
              title="No organizations found"
              description="Create your first organization to get started"
            />
          ) : (
            organizations.map((org) => (
              <TableRow key={org.organization?.id}>
                <TableCell>
                  <div className="flex items-center gap-3">
                    <div className="h-10 w-10 rounded-lg bg-gradient-to-br from-blue-500/20 to-blue-600/20 flex items-center justify-center border border-blue-500/30">
                      <Buildings size={20} weight="duotone" className="text-blue-600 dark:text-blue-400" />
                    </div>
                    <div>
                      <div className="font-semibold text-foreground">{org.organization?.name}</div>
                      <div className="flex items-center gap-1.5 group/copy">
                        <span className="text-xs text-muted-foreground font-mono">{org.organization?.id?.slice(0, 8)}...</span>
                        <button
                          type="button"
                          onClick={(e) => handleCopyId(e, org.organization?.id || '')}
                          className="opacity-0 group-hover:opacity-100 group-hover/copy:opacity-100 rounded p-0.5 hover:bg-accent transition-all relative z-10"
                          title="Copy full UUID"
                        >
                          {copiedId === org.organization?.id ? (
                            <Check size={12} weight="bold" className="text-green-600 dark:text-green-400" />
                          ) : (
                            <Clipboard size={12} className="text-muted-foreground hover:text-foreground" />
                          )}
                        </button>
                      </div>
                    </div>
                  </div>
                </TableCell>
                <TableCell>
                  <code className="px-2 py-1 rounded bg-muted text-xs font-mono">{org.organization?.slug}</code>
                </TableCell>
                <TableCell className="text-muted-foreground">{org.organization?.logoUrl || '-'}</TableCell>
                <TableCell>
                  <span className="bg-muted text-muted-foreground inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold capitalize">
                    -
                  </span>
                </TableCell>
                <TableCell align="center">
                  <span className="inline-flex items-center justify-center h-7 w-7 rounded-full bg-primary/10 text-primary text-xs font-semibold">
                    {org.memberCount}
                  </span>
                </TableCell>
                <TableCell align="center">
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
                </TableCell>
                <TableCell align="right">
                  <Button
                    variant="ghost"
                    size="xs"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleEdit(org);
                    }}
                    className="opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    <PencilSimple size={14} />
                    Edit
                  </Button>
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>

      <OrganizationEditDialog
        org={selectedOrg}
        isOpen={isDialogOpen}
        onClose={handleClose}
        onSave={handleSave}
      />
    </div>
  );
}
