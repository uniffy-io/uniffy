import { useState, useEffect, useCallback } from 'react';
import { createClient } from "@connectrpc/connect";
import { OrganizationsService } from "@uniffy/proto/organizations/v1/organizations_pb";
import type { OrganizationDetail } from "@uniffy/proto/organizations/v1/organizations_pb";
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
import { OrganizationEditDialog } from "@/features/admin/components/OrganizationEditDialog";
import { unaryTransport } from "@/config";
import { useDocumentTitle } from "@/shared/hooks/useDocumentTitle";
import { Buildings, Plus, PencilSimple, Clipboard, Check } from '@phosphor-icons/react';


export function OrganizationsPage() {
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
      const client = createClient(OrganizationsService, unaryTransport);
      const response = await client.listOrganizations(
        { pagination: { page: 1, pageSize: 100 } },
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );
      setOrganizations(response.organizations);
    } catch {
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
    } catch {
      // copy failed silently
    }
  };

  return (
    <div className="flex flex-col gap-6 max-w-5xl w-full mx-auto">
      <div className="flex items-start gap-3">
        <div className="p-2 rounded-lg bg-primary/10 shrink-0">
          <Buildings size={22} weight="duotone" className="text-primary" />
        </div>
        <div className="flex-1 min-w-0">
          <h1 className="text-xl font-semibold text-foreground">Organizations</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Manage all organizations in the deployment.
          </p>
        </div>
        <Button size="sm" onClick={handleCreate} className="shrink-0">
          <Plus size={14} />
          <span className="hidden sm:inline ml-1">Add organization</span>
        </Button>
      </div>

      {error && (
        <div className="rounded-xl border p-4" style={{ borderColor: 'color-mix(in srgb, var(--status-error) 20%, transparent)', backgroundColor: 'color-mix(in srgb, var(--status-error) 5%, transparent)' }}>
          <p className="text-sm" style={{ color: 'var(--status-error)' }}>{error}</p>
        </div>
      )}

      {/* Organizations Table */}
      <Table>
        <TableHeader>
          <TableRow hoverable={false}>
            <TableHead>Name</TableHead>
            <TableHead className="hidden lg:table-cell">Slug</TableHead>
            <TableHead className="hidden lg:table-cell">Domain</TableHead>
            <TableHead className="hidden md:table-cell">Plan</TableHead>
            <TableHead align="center">Members</TableHead>
            <TableHead align="center" className="hidden sm:table-cell">Status</TableHead>
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
                            <Check size={12} weight="bold" style={{ color: 'var(--status-success)' }} />
                          ) : (
                            <Clipboard size={12} className="text-muted-foreground hover:text-foreground" />
                          )}
                        </button>
                      </div>
                    </div>
                  </div>
                </TableCell>
                <TableCell className="hidden lg:table-cell">
                  <code className="px-2 py-1 rounded bg-muted text-xs font-mono">{org.organization?.slug}</code>
                </TableCell>
                <TableCell className="text-muted-foreground hidden lg:table-cell">{org.organization?.logoUrl || '-'}</TableCell>
                <TableCell className="hidden md:table-cell">
                  <span className="bg-muted text-muted-foreground inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold capitalize">
                    -
                  </span>
                </TableCell>
                <TableCell align="center">
                  <span className="inline-flex items-center justify-center h-7 w-7 rounded-full bg-primary/10 text-primary text-xs font-semibold">
                    {org.memberCount}
                  </span>
                </TableCell>
                <TableCell align="center" className="hidden sm:table-cell">
                  <div className="flex items-center justify-center gap-2">
                    <span className="h-2 w-2 rounded-full animate-pulse" style={{ backgroundColor: org.isActive ? 'var(--status-success)' : 'var(--status-error)' }} />
                    <span className="text-xs font-medium" style={{ color: org.isActive ? 'var(--status-success)' : 'var(--status-error)' }}>
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
