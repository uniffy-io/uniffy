import { useMemo, useState } from "react";
import { ContentRole, AccessMode } from "@uniffy/proto/common/v1/common_pb";
import { ShieldCheck, ArrowRight } from "@phosphor-icons/react";
import { useAppSelector } from "@/app/hooks";
import { SubjectAvatar } from "@/components/subject/SubjectAvatar";
import { SubjectPicker } from "@/components/subject/SubjectPicker";
import { useSubjectResolver } from "@/components/subject/hooks/useSubjectResolver";
import { SUBJECT_TYPE, type Subject } from "@/components/subject/types";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { roleCanManage, roleCanTransfer } from "@/shared/utils/contentRoles";
import { useContentMembers } from "@/features/permissions/hooks/useContentMembers";
import { useMyContentRole } from "@/features/permissions/hooks/useMyContentRole";
import { AccessModeSelector } from "@/features/permissions/components/AccessModeSelector";
import { AddMemberPopover } from "@/features/permissions/components/AddMemberPopover";
import { MemberRow } from "@/features/permissions/components/MemberRow";
import { BlockedMembersSection } from "@/features/permissions/components/BlockedMembersSection";
import { AuditLogPanel } from "@/features/permissions/components/AuditLogPanel";
import type { SerializedContentMember } from "@/features/permissions/store/permissionsSlice";

interface AccessPolicyPanelProps {
  contentType: number;
  contentId: string;
  contentTitle?: string;
  showAuditLink?: boolean;
  explicitUserRole?: ContentRole | number | null;
}

export function AccessPolicyPanel({
  contentType,
  contentId,
  showAuditLink = false,
  explicitUserRole,
}: AccessPolicyPanelProps) {
  const currentUserId = useAppSelector((s) => s.auth.user?.id ?? "");
  const { policy, members, loading, error, add, update, remove, setMode, transfer, refresh } =
    useContentMembers(contentType, contentId);
  const myRole = useMyContentRole(contentType, contentId, explicitUserRole);
  const canManage = roleCanManage(myRole);
  const canTransfer = roleCanTransfer(myRole);

  const [showAudit, setShowAudit] = useState(false);
  const [transferring, setTransferring] = useState(false);
  const [confirmPersonal, setConfirmPersonal] = useState(false);
  const [narrowing, setNarrowing] = useState(false);

  const ownerIds = useMemo(() => (policy?.ownerId ? [policy.ownerId] : []), [policy?.ownerId]);
  const { subjects: ownerSubjects } = useSubjectResolver(ownerIds);
  const owner = ownerSubjects[0];

  const { active, blocked } = useMemo(() => {
    const a: SerializedContentMember[] = [];
    const b: SerializedContentMember[] = [];
    for (const m of members) {
      if (m.role === ContentRole.BLOCKED) b.push(m);
      else a.push(m);
    }
    a.sort((x, y) => {
      if (x.subjectType !== y.subjectType) {
        return x.subjectType === SUBJECT_TYPE.GROUP ? -1 : 1;
      }
      return 0;
    });
    return { active: a, blocked: b };
  }, [members]);

  const existingSubjectIds = useMemo(
    () => members.map((m) => m.subjectId).concat(policy?.ownerId ? [policy.ownerId] : []),
    [members, policy?.ownerId],
  );

  // The resolved mode after org-default inheritance; an UNSPECIFIED row still
  // resolves to OWNER_ONLY when that's the org default.
  const resolvedAccessMode = policy?.effectiveAccessMode ?? policy?.accessMode;
  const isPersonal = resolvedAccessMode === AccessMode.OWNER_ONLY;

  const handleAdd = async (subject: Subject, role: ContentRole, expiresAt?: Date) => {
    // The backend rejects members while access resolves to OWNER_ONLY.
    // Inviting someone implies sharing, so widen a personal item to
    // EXPLICIT_MEMBERS first, then add.
    if (isPersonal) {
      await setMode(AccessMode.EXPLICIT_MEMBERS, null);
    }
    await add(subject.type, subject.id, role, expiresAt);
  };

  const handleModeChange = (next: {
    accessMode: AccessMode | number;
    baselineRole: ContentRole | number | null;
  }) => {
    // Narrowing to OWNER_ONLY orphans existing members; the backend refuses
    // unless we opt into removing them. Confirm first, then remove on narrow.
    if (next.accessMode === AccessMode.OWNER_ONLY && active.length > 0) {
      setConfirmPersonal(true);
      return;
    }
    setMode(next.accessMode, next.baselineRole);
  };

  const confirmMakePersonal = async () => {
    setNarrowing(true);
    try {
      await setMode(AccessMode.OWNER_ONLY, null, true);
      // The narrow deleted the member rows server-side; refetch so the
      // list reflects reality (setAccessMode only returns the policy).
      await refresh();
      setConfirmPersonal(false);
    } finally {
      setNarrowing(false);
    }
  };

  const handleUnblock = async (member: SerializedContentMember) => {
    await remove(member.subjectType, member.subjectId);
  };

  const handleTransfer = async (subject: Subject) => {
    if (subject.type !== SUBJECT_TYPE.USER) return;
    setTransferring(true);
    try {
      await transfer(subject.id);
    } finally {
      setTransferring(false);
    }
  };

  if (loading && !policy) {
    return <div className="py-6 text-sm text-muted-foreground text-center">Loading access...</div>;
  }

  if (error) {
    return <div className="py-4 text-sm text-red-600 dark:text-red-400">{error}</div>;
  }

  if (!policy) return null;

  const isOwner = policy.ownerId === currentUserId;

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
          Owner
        </h3>
        <div className="flex items-center gap-3 py-2 px-3 rounded-lg bg-muted/30">
          <SubjectAvatar subject={owner} size="md" />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <div className="text-sm font-medium text-foreground truncate">
                {owner?.name ?? "Unknown"}
              </div>
              {isOwner && <span className="text-xs text-muted-foreground">(you)</span>}
            </div>
            {owner?.email && (
              <div className="text-xs text-muted-foreground truncate">{owner.email}</div>
            )}
          </div>
          <div className="flex items-center gap-1 text-sm text-muted-foreground">
            <ShieldCheck size={16} weight="fill" />
            <span>Owner</span>
          </div>
          {canTransfer && (
            <TransferOwnershipButton
              existingSubjectIds={existingSubjectIds}
              onTransfer={handleTransfer}
              disabled={transferring}
            />
          )}
        </div>
      </div>

      <div>
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
          Access
        </h3>
        <AccessModeSelector
          value={{
            accessMode: policy.accessMode as AccessMode,
            baselineRole: policy.baselineRole,
          }}
          onChange={handleModeChange}
          disabled={!canManage}
          showInheritOption
        />
      </div>

      <div>
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Members{" "}
            {active.length > 0 && <span className="ml-1 font-normal">({active.length})</span>}
          </h3>
          {canManage && (
            <AddMemberPopover existingSubjectIds={existingSubjectIds} onAdd={handleAdd} />
          )}
        </div>
        {canManage && isPersonal && (
          <p className="text-xs text-muted-foreground mb-2">
            This is personal. Adding people switches it to{" "}
            <span className="font-medium text-foreground">Invited people</span>.
          </p>
        )}
        {active.length === 0 ? (
          <div className="py-4 text-center text-sm text-muted-foreground border border-dashed border-border rounded-lg">
            No members yet
          </div>
        ) : (
          <div className="space-y-1">
            {active.map((m) => (
              <MemberRow
                key={`${m.subjectType}:${m.subjectId}`}
                member={m}
                canEdit={canManage}
                onUpdate={(role) => {
                  update(m.subjectType, m.subjectId, role);
                }}
                onRemove={() => remove(m.subjectType, m.subjectId)}
              />
            ))}
          </div>
        )}
        <BlockedMembersSection members={blocked} canEdit={canManage} onUnblock={handleUnblock} />
      </div>

      {showAuditLink && (
        <div>
          <button
            type="button"
            onClick={() => setShowAudit((v) => !v)}
            className="text-sm text-primary hover:underline inline-flex items-center gap-1"
          >
            {showAudit ? "Hide" : "View"} access history
            <ArrowRight size={14} weight="bold" />
          </button>
          {showAudit && (
            <div className="mt-3">
              <AuditLogPanel contentType={contentType} contentId={contentId} />
            </div>
          )}
        </div>
      )}

      <ConfirmDialog
        isOpen={confirmPersonal}
        onClose={() => setConfirmPersonal(false)}
        onConfirm={confirmMakePersonal}
        title="Make personal?"
        message={`Only you will have access. This removes ${active.length} member${active.length !== 1 ? "s" : ""} from this item.`}
        confirmLabel="Make personal"
        variant="danger"
        loading={narrowing}
      />
    </div>
  );
}

interface TransferOwnershipButtonProps {
  existingSubjectIds: string[];
  onTransfer: (subject: Subject) => Promise<void> | void;
  disabled?: boolean;
}

function TransferOwnershipButton({
  existingSubjectIds,
  onTransfer,
  disabled,
}: TransferOwnershipButtonProps) {
  const [open, setOpen] = useState(false);

  return (
    <div className="relative">
      <Button size="xs" variant="ghost" onClick={() => setOpen((v) => !v)} disabled={disabled}>
        Transfer
      </Button>
      {open && (
        <TransferPicker
          existingSubjectIds={existingSubjectIds}
          onClose={() => setOpen(false)}
          onSelect={async (subject) => {
            await onTransfer(subject);
            setOpen(false);
          }}
        />
      )}
    </div>
  );
}

function TransferPicker({
  existingSubjectIds,
  onClose,
  onSelect,
}: {
  existingSubjectIds: string[];
  onClose: () => void;
  onSelect: (subject: Subject) => void;
}) {
  return (
    <div className="absolute right-0 top-full mt-1 z-50 w-72">
      <SubjectPicker
        mode="single"
        subjectTypes="users"
        value={[]}
        onChange={(_ids, subjects) => {
          if (subjects[0]) onSelect(subjects[0]);
        }}
        excludeIds={existingSubjectIds}
        onClose={onClose}
        autoFocus
        dropdownWidth={280}
      />
    </div>
  );
}
