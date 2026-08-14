import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import {
  ArrowCounterClockwise,
  Calendar,
  Clock,
  Crown,
  Envelope,
  Info,
  Key,
  Lifebuoy,
  PencilSimple,
  Prohibit,
  ShieldWarning,
  Tag,
  Trash,
  UserCircle,
  Users as UsersIcon,
  X,
} from "@phosphor-icons/react";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { ReasonDialog } from "@/components/ui/reason-dialog";
import { cn } from "@/shared/utils/cn";
import { formatProtoDateTime, formatRelativeTime } from "@/shared/utils/dateFormatting";
import { friendlyErrorMessage } from "@/config";
import { getAvatarGradientStyle, getInitials } from "@/components/subject/utils";
import { platformOrgsApi } from "@/features/platform/api/systemDirectoryApi";
import { EditOrganizationDialog } from "@/features/platform/components/EditOrganizationDialog";
import { RequestSupportSessionDialog } from "@/features/platform/components/RequestSupportSessionDialog";
import type { PlatformOrganizationDetail } from "@uniffy/proto/superadmin/v1/system_directory_pb";

type PendingOrgAction = "suspend" | "unsuspend" | "restore" | "delete";

type ProtoTimestamp = { seconds: number | bigint; nanos: number };

function protoToDate(ts: ProtoTimestamp | undefined): Date | undefined {
  if (!ts) return undefined;
  const ms = typeof ts.seconds === "bigint" ? Number(ts.seconds) * 1000 : ts.seconds * 1000;
  return new Date(ms);
}

type Tab = "info" | "owners";

interface Props {
  organizationId: string;
  onClose: () => void;
  onChanged: () => void;
}

function Field({
  label,
  icon: Icon,
  children,
  className,
}: {
  label: string;
  icon?: typeof Info;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      <p className="text-xs font-medium text-muted-foreground mb-1">{label}</p>
      <div className="flex items-center gap-2 p-2 rounded-md bg-muted/50 min-h-9">
        {Icon && <Icon size={16} weight="duotone" className="text-muted-foreground shrink-0" />}
        <span className="text-sm min-w-0 break-all">{children}</span>
      </div>
    </div>
  );
}

export function PlatformOrgDetailDialog({ organizationId, onClose, onChanged }: Props) {
  const [detail, setDetail] = useState<PlatformOrganizationDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [tab, setTab] = useState<Tab>("info");
  const [supportOpen, setSupportOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [pending, setPending] = useState<PendingOrgAction | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const response = await platformOrgsApi.get({ organizationId });
      setDetail(response.organization ?? null);
    } catch (error) {
      const message = friendlyErrorMessage((error as Error).message);
      if (message) toast.error(message);
    } finally {
      setLoading(false);
    }
  }, [organizationId]);

  useEffect(() => {
    // eslint-disable-next-line react/react-compiler -- fetch on mount and whenever the dialog switches org; refresh raises the loading flag before awaiting the API
    refresh();
  }, [refresh]);

  const runPending = async (reason: string) => {
    if (!detail?.summary || !pending) return;
    const kind = pending;
    const slug = detail.summary.slug;
    setSubmitting(true);
    try {
      if (kind === "suspend") {
        await platformOrgsApi.suspend({ organizationId, reason });
        toast.success("Workspace suspended");
      } else if (kind === "unsuspend") {
        await platformOrgsApi.unsuspend({ organizationId, reason });
        toast.success("Workspace unsuspended");
      } else if (kind === "restore") {
        await platformOrgsApi.restore({ organizationId, reason });
        toast.success("Workspace restored");
      } else {
        await platformOrgsApi.delete({ organizationId, confirmSlug: slug, reason });
        toast.success("Workspace deleted. Owners notified.");
      }
      setPending(null);
      await refresh();
      onChanged();
    } catch (error) {
      const message = friendlyErrorMessage((error as Error).message);
      if (message) toast.error(message);
    } finally {
      setSubmitting(false);
    }
  };

  const tabs: Array<{ id: Tab; label: string; icon: typeof Info }> = [
    { id: "info", label: "Info", icon: Info },
    { id: "owners", label: "Owners", icon: Crown },
  ];

  const summary = detail?.summary;
  const purgeAt = summary ? protoToDate(summary.purgeAt) : undefined;
  const lastActivity = summary ? protoToDate(summary.lastActivityAt) : undefined;
  const lastLogin = summary ? protoToDate(summary.lastLoginAt) : undefined;

  const renderInfoTab = () => {
    if (!summary || !detail) return null;
    return (
      <div className="space-y-4">
        {summary.deletedAt && (
          <div className="rounded-md border border-red-500/30 bg-red-500/5 p-3">
            <div className="flex items-center gap-2 text-sm font-medium text-red-700 dark:text-red-400">
              <Trash size={14} weight="duotone" />
              Scheduled for deletion
            </div>
            {purgeAt && (
              <p className="text-xs text-muted-foreground mt-1">
                Purge {formatRelativeTime(purgeAt.toISOString())}
              </p>
            )}
            {detail.deletionReason && (
              <p className="text-xs mt-2">
                <span className="text-muted-foreground">Reason: </span>
                {detail.deletionReason}
              </p>
            )}
          </div>
        )}
        {summary.isSuspended && !summary.deletedAt && (
          <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3">
            <div className="flex items-center gap-2 text-sm font-medium text-amber-700 dark:text-amber-400">
              <ShieldWarning size={14} weight="duotone" />
              Suspended
            </div>
            {detail.suspensionReason && (
              <p className="text-xs mt-2">
                <span className="text-muted-foreground">Reason: </span>
                {detail.suspensionReason}
              </p>
            )}
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Plan" icon={Tag}>
            <span className="capitalize">{summary.plan}</span>
          </Field>
          <Field label="Members" icon={UsersIcon}>
            {summary.memberCount}
            {detail.maxMembers !== undefined && (
              <span className="text-muted-foreground"> / {detail.maxMembers} cap</span>
            )}
          </Field>
          <Field label="Mail config" icon={Envelope}>
            <span className="capitalize">{summary.mailConfigSource.replace("_", " ")}</span>
          </Field>
          <Field label="Encryption" icon={Key}>
            {summary.encryptionVersion > 0
              ? `Active DEK v${summary.encryptionVersion}`
              : "Not provisioned"}
          </Field>
          <Field label="Created" icon={Calendar}>
            {formatProtoDateTime(summary.createdAt)}
          </Field>
          {detail.domain && (
            <Field label="Domain">
              <span className="font-mono">{detail.domain}</span>
            </Field>
          )}
          {lastActivity && (
            <Field label="Last activity" icon={Clock}>
              {formatRelativeTime(lastActivity.toISOString())}
            </Field>
          )}
          {lastLogin && (
            <Field label="Last login" icon={Clock}>
              {formatRelativeTime(lastLogin.toISOString())}
            </Field>
          )}
        </div>
      </div>
    );
  };

  const renderOwnersTab = () => {
    if (!detail) return null;
    if (detail.owners.length === 0) {
      return (
        <div className="text-center py-8">
          <Crown size={32} weight="duotone" className="mx-auto text-muted-foreground/50 mb-3" />
          <p className="text-sm text-muted-foreground">No active owners</p>
        </div>
      );
    }
    return (
      <div className="space-y-2">
        {detail.owners.map((owner) => {
          const name = owner.fullName || owner.email;
          return (
            <div key={owner.userId} className="flex items-center gap-3 p-2 rounded-md bg-muted/50">
              <div
                className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-medium text-white shrink-0"
                style={getAvatarGradientStyle(name)}
              >
                {getInitials(name)}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <UserCircle
                    size={14}
                    weight="duotone"
                    className="text-muted-foreground shrink-0"
                  />
                  <span className="text-sm font-medium truncate">{name}</span>
                </div>
                <p className="text-xs text-muted-foreground truncate">{owner.email}</p>
              </div>
              <span className="text-xs text-muted-foreground shrink-0">
                Joined {formatRelativeTime(protoToDate(owner.joinedAt)?.toISOString() ?? "")}
              </span>
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <Modal onClose={onClose} closeDisabled={submitting} maxWidth="max-w-2xl">
      <div className="flex items-center gap-3 p-4 border-b border-border">
        <div
          className="w-11 h-11 rounded-lg flex items-center justify-center text-sm font-semibold text-white shrink-0"
          style={summary ? getAvatarGradientStyle(summary.name) : undefined}
        >
          {summary ? getInitials(summary.name) : ""}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-base font-semibold text-foreground truncate">
            {summary?.name ?? "Organization"}
          </div>
          {summary && (
            <code className="text-xs text-muted-foreground font-mono truncate block">
              {summary.slug}
            </code>
          )}
        </div>
        <button
          type="button"
          onClick={onClose}
          disabled={submitting}
          className="text-muted-foreground hover:text-foreground p-1"
          aria-label="Close"
        >
          <X size={16} weight="bold" />
        </button>
      </div>

      <div className="flex border-b border-border">
        {tabs.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={cn(
              "flex items-center justify-center gap-1.5 px-4 py-2.5 text-sm font-medium transition-colors relative",
              tab === id ? "text-foreground" : "text-muted-foreground hover:text-foreground",
            )}
          >
            <Icon size={16} weight="duotone" />
            {label}
            {tab === id && <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary" />}
          </button>
        ))}
      </div>

      <div className="p-4 max-h-[55vh] overflow-y-auto">
        {loading || !detail ? (
          <div className="py-12 text-center text-sm text-muted-foreground">Loading...</div>
        ) : tab === "owners" ? (
          renderOwnersTab()
        ) : (
          renderInfoTab()
        )}
      </div>

      {summary && (
        <div className="flex flex-wrap items-center gap-2 p-4 border-t border-border">
          {!summary.deletedAt && (
            <>
              <Button
                variant="outline"
                size="sm"
                disabled={submitting}
                onClick={() => setEditOpen(true)}
              >
                <PencilSimple size={14} weight="duotone" /> Edit settings
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={submitting}
                onClick={() => setSupportOpen(true)}
              >
                <Lifebuoy size={14} weight="duotone" /> Support session
              </Button>
            </>
          )}
          <div className="flex items-center gap-2 ml-auto">
            {summary.deletedAt ? (
              <Button
                variant="default"
                size="sm"
                disabled={submitting}
                onClick={() => setPending("restore")}
              >
                <ArrowCounterClockwise size={14} weight="duotone" /> Restore
              </Button>
            ) : summary.isSuspended ? (
              <Button
                variant="default"
                size="sm"
                disabled={submitting}
                onClick={() => setPending("unsuspend")}
              >
                <ArrowCounterClockwise size={14} weight="duotone" /> Unsuspend
              </Button>
            ) : (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={submitting}
                  onClick={() => setPending("suspend")}
                >
                  <Prohibit size={14} weight="duotone" /> Suspend
                </Button>
                <Button
                  variant="destructive"
                  size="sm"
                  disabled={submitting}
                  onClick={() => setPending("delete")}
                >
                  <Trash size={14} weight="duotone" /> Delete
                </Button>
              </>
            )}
          </div>
        </div>
      )}

      {supportOpen && summary && (
        <RequestSupportSessionDialog
          organizationId={organizationId}
          organizationName={summary.name}
          onClose={() => setSupportOpen(false)}
          onCreated={() => {
            refresh();
            onChanged();
          }}
        />
      )}

      {editOpen && detail && (
        <EditOrganizationDialog
          detail={detail}
          onClose={() => setEditOpen(false)}
          onSaved={() => {
            refresh();
            onChanged();
          }}
        />
      )}

      <ReasonDialog
        isOpen={!!pending && !!summary}
        onClose={() => {
          if (!submitting) setPending(null);
        }}
        onConfirm={runPending}
        title={
          !summary
            ? ""
            : pending === "suspend"
              ? `Suspend ${summary.name}?`
              : pending === "unsuspend"
                ? `Unsuspend ${summary.name}?`
                : pending === "restore"
                  ? `Restore ${summary.name}?`
                  : `Delete ${summary.name}?`
        }
        description={
          pending === "suspend"
            ? "Bumps token_version for every member. Existing JWTs invalidated; new logins blocked."
            : pending === "unsuspend"
              ? "Members can log in again. Their JWTs were invalidated at suspend time."
              : pending === "restore"
                ? "Clears the scheduled purge. The workspace becomes accessible again."
                : pending === "delete"
                  ? "Soft-deletes the workspace. Restorable for 30 days; owners are notified."
                  : undefined
        }
        confirmSlug={
          pending === "delete" && summary
            ? {
                slug: summary.slug,
                helperText: "Workspace stays restorable for 30 days after this point.",
              }
            : undefined
        }
        confirmLabel={
          pending === "suspend"
            ? "Suspend"
            : pending === "unsuspend"
              ? "Unsuspend"
              : pending === "restore"
                ? "Restore"
                : "Delete"
        }
        variant={pending === "unsuspend" || pending === "restore" ? "warning" : "danger"}
        loading={submitting}
      />
    </Modal>
  );
}
