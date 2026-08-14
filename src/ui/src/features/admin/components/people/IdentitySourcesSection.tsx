import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { ArrowsClockwise, Pencil, Plus, Plugs, Trash, Warning, X } from "@phosphor-icons/react";
import { useAppSelector } from "@/app/hooks";
import { friendlyErrorMessage } from "@/config";
import { peopleApi } from "@/features/people/api/peopleApi";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Select, type SelectOption } from "@/components/ui/select";
import { ToggleSwitch } from "@/components/ui/toggle-switch";
import { IdentitySourceKind } from "@uniffy/proto/people/v1/people_pb";
import type { IdentitySource } from "@uniffy/proto/people/v1/people_pb";
import { formatProtoDateTime } from "@/shared/utils/dateFormatting";

const KIND_OPTIONS: SelectOption<IdentitySourceKind>[] = [
  { value: IdentitySourceKind.SCIM, label: "SCIM (Okta, Entra ID push)" },
  { value: IdentitySourceKind.LDAP, label: "LDAP / Active Directory" },
  { value: IdentitySourceKind.OIDC, label: "OIDC single sign-on" },
];

const KIND_LABELS: Record<number, string> = {
  [IdentitySourceKind.LOCAL]: "Local",
  [IdentitySourceKind.SCIM]: "SCIM",
  [IdentitySourceKind.LDAP]: "LDAP",
  [IdentitySourceKind.OIDC]: "OIDC",
};

const STATUS_CLASSES: Record<string, string> = {
  succeeded: "text-green-700 dark:text-green-400",
  running: "text-muted-foreground",
  failed: "text-red-700 dark:text-red-400",
  aborted: "text-amber-700 dark:text-amber-400",
};

interface SourceFormModalProps {
  source?: IdentitySource | null;
  onSave: (values: { kind: IdentitySourceKind; name: string; secret?: string }) => Promise<void>;
  onClose: () => void;
}

function SourceFormModal({ source, onSave, onClose }: SourceFormModalProps) {
  const [kind, setKind] = useState<IdentitySourceKind>(source?.kind ?? IdentitySourceKind.SCIM);
  const [name, setName] = useState(source?.name ?? "");
  const [secret, setSecret] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setError("Name is required");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onSave({ kind, name: name.trim(), secret: secret || undefined });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save source");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50">
      <div className="w-full sm:w-[calc(100vw-2rem)] sm:max-w-md bg-card rounded-t-xl sm:rounded-xl border border-border shadow-xl">
        <div className="flex items-center justify-between px-4 md:px-6 py-3 md:py-4 border-b border-border">
          <h2 className="text-lg font-semibold">
            {source ? "Edit Identity Source" : "Connect Identity Source"}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          >
            <X size={20} weight="bold" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-4 md:p-6 space-y-4">
          {error && <div className="p-3 rounded-md text-sm status-error">{error}</div>}

          {!source && (
            <div>
              <label className="block text-sm font-medium mb-1">Provider</label>
              <Select<IdentitySourceKind>
                value={kind}
                onChange={setKind}
                options={KIND_OPTIONS}
                ariaLabel="Source kind"
                menuMinWidth={220}
              />
              <p className="mt-1.5 text-xs text-muted-foreground">
                Connectors ship in a future release; the connection can be configured now.
              </p>
            </div>
          )}

          <div>
            <label className="block text-sm font-medium mb-1">Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Okta production"
              className="w-full px-3 py-2 rounded-md border border-border bg-background
                                text-sm focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Secret</label>
            <input
              type="password"
              value={secret}
              onChange={(e) => setSecret(e.target.value)}
              placeholder={
                source ? "Leave empty to keep the current secret" : "Bearer token / bind password"
              }
              autoComplete="new-password"
              className="w-full px-3 py-2 rounded-md border border-border bg-background
                                text-sm focus:outline-none focus:ring-2 focus:ring-primary"
            />
            <p className="mt-1.5 text-xs text-muted-foreground">
              Stored encrypted with the organization key; never shown again.
            </p>
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <Button variant="ghost" size="md" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" size="md" loading={saving} disabled={saving}>
              {saving ? "Saving..." : source ? "Save Changes" : "Connect"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

function SourceRow({
  source,
  onEdit,
  onDelete,
  onToggleActive,
  onSync,
}: {
  source: IdentitySource;
  onEdit: (source: IdentitySource) => void;
  onDelete: (source: IdentitySource) => void;
  onToggleActive: (source: IdentitySource, next: boolean) => void;
  onSync: (source: IdentitySource) => void;
}) {
  const isLocal = source.kind === IdentitySourceKind.LOCAL;
  const status = source.lastSyncStatus;

  return (
    <div className="flex items-center gap-4 p-4">
      <div className="p-2 rounded-lg bg-primary/10 flex-shrink-0">
        <Plugs size={20} weight="duotone" className="text-primary" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <h3 className="font-medium truncate">{source.name}</h3>
          <span className="shrink-0 rounded-full bg-muted px-2 py-px text-[10px] font-semibold text-muted-foreground">
            {KIND_LABELS[source.kind] ?? "Unknown"}
          </span>
        </div>
        <p className="text-xs text-muted-foreground mt-0.5 truncate">
          {isLocal ? (
            "Accounts created in this workspace."
          ) : status ? (
            <>
              Last sync <span className={STATUS_CLASSES[status] ?? ""}>{status}</span>
              {source.lastSyncAt ? ` · ${formatProtoDateTime(source.lastSyncAt)}` : ""}
              {source.lastSyncError ? ` · ${source.lastSyncError}` : ""}
            </>
          ) : (
            "Never synced."
          )}
        </p>
      </div>
      {!isLocal && (
        <>
          <ToggleSwitch
            enabled={source.isActive}
            onChange={(next) => onToggleActive(source, next)}
          />
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => onSync(source)}
              className="p-2 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              title="Sync now"
            >
              <ArrowsClockwise size={16} />
            </button>
            <button
              type="button"
              onClick={() => onEdit(source)}
              className="p-2 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              title="Edit source"
            >
              <Pencil size={16} />
            </button>
            <button
              type="button"
              onClick={() => onDelete(source)}
              className="p-2 rounded-md text-muted-foreground hover-destructive transition-colors"
              title="Delete source"
            >
              <Trash size={16} />
            </button>
          </div>
        </>
      )}
    </div>
  );
}

export function IdentitySourcesSection() {
  const organizationId = useAppSelector((state) => state.auth.currentOrganizationId);
  const [sources, setSources] = useState<IdentitySource[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [editing, setEditing] = useState<IdentitySource | null>(null);
  const [deleting, setDeleting] = useState<IdentitySource | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  const reload = useCallback(async () => {
    if (!organizationId) return;
    setLoading(true);
    setError(null);
    try {
      setSources(await peopleApi.listIdentitySources(organizationId));
    } catch (err) {
      setError(
        friendlyErrorMessage(err instanceof Error ? err.message : String(err)) ??
          "Could not load identity sources",
      );
    } finally {
      setLoading(false);
    }
  }, [organizationId]);

  useEffect(() => {
    // eslint-disable-next-line react/react-compiler -- fetch on mount; reload raises the loading flag before awaiting the API
    void reload();
  }, [reload]);

  const handleCreate = async (values: {
    kind: IdentitySourceKind;
    name: string;
    secret?: string;
  }) => {
    if (!organizationId) return;
    await peopleApi.createIdentitySource({
      organizationId,
      kind: values.kind,
      name: values.name,
      configJson: "{}",
      secret: values.secret,
    });
    await reload();
  };

  const handleEdit = async (values: {
    kind: IdentitySourceKind;
    name: string;
    secret?: string;
  }) => {
    if (!organizationId || !editing) return;
    await peopleApi.updateIdentitySource({
      organizationId,
      sourceId: editing.id,
      name: values.name,
      secret: values.secret,
    });
    await reload();
  };

  const handleToggleActive = async (source: IdentitySource, next: boolean) => {
    if (!organizationId) return;
    try {
      await peopleApi.updateIdentitySource({
        organizationId,
        sourceId: source.id,
        isActive: next,
      });
      await reload();
    } catch (err) {
      toast.error(
        friendlyErrorMessage(err instanceof Error ? err.message : String(err)) ??
          "Could not update the source",
      );
    }
  };

  const handleSync = async (source: IdentitySource) => {
    if (!organizationId) return;
    try {
      await peopleApi.triggerDirectorySync(organizationId, source.id);
      toast.success("Sync queued");
      await reload();
    } catch (err) {
      toast.error(
        friendlyErrorMessage(err instanceof Error ? err.message : String(err)) ??
          "Could not start the sync",
      );
    }
  };

  const handleDelete = async () => {
    if (!organizationId || !deleting) return;
    setDeleteBusy(true);
    try {
      await peopleApi.deleteIdentitySource(organizationId, deleting.id);
      setDeleting(null);
      await reload();
    } catch (err) {
      toast.error(
        friendlyErrorMessage(err instanceof Error ? err.message : String(err)) ??
          "Could not delete the source",
      );
    } finally {
      setDeleteBusy(false);
    }
  };

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold">Identity sources</h2>
          <p className="text-muted-foreground text-sm hidden sm:block">
            Where member accounts and org structure come from. One sync source can be active at a
            time.
          </p>
        </div>
        <Button size="md" className="shrink-0" onClick={() => setShowCreate(true)}>
          <Plus size={16} />
          <span className="hidden sm:inline">Connect Source</span>
        </Button>
      </div>

      {error && (
        <div className="p-4 rounded-lg border border-border">
          <div className="flex items-center gap-2 text-sm" style={{ color: "var(--status-error)" }}>
            <Warning size={20} weight="fill" />
            {error}
          </div>
        </div>
      )}

      {loading ? (
        <div className="rounded-lg border border-border bg-card p-5 text-sm text-muted-foreground">
          Loading...
        </div>
      ) : (
        <div className="rounded-xl border border-border bg-card divide-y divide-border">
          {sources.map((source) => (
            <SourceRow
              key={source.id}
              source={source}
              onEdit={setEditing}
              onDelete={setDeleting}
              onToggleActive={handleToggleActive}
              onSync={handleSync}
            />
          ))}
        </div>
      )}

      {showCreate && <SourceFormModal onSave={handleCreate} onClose={() => setShowCreate(false)} />}
      {editing && (
        <SourceFormModal source={editing} onSave={handleEdit} onClose={() => setEditing(null)} />
      )}
      {deleting && (
        <ConfirmDialog
          isOpen
          onClose={() => setDeleting(null)}
          onConfirm={handleDelete}
          title="Delete Identity Source"
          message={`Delete "${deleting.name}"? Its stored secret is removed and synced accounts stay but are no longer linked.`}
          confirmLabel="Delete"
          variant="danger"
          loading={deleteBusy}
        />
      )}
    </section>
  );
}
