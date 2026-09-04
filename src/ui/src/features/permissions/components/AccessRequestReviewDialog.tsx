import { useEffect, useState } from "react";
import { CheckCircle, ChatCircle, Clock, LockKeyOpen, Prohibit } from "@phosphor-icons/react";
import { AccessMode, ContentRole, ContentType } from "@uniffy/proto/common/v1/common_pb";
import {
  AccessRequestDecision,
  AccessRequestState,
} from "@uniffy/proto/permissions/v1/permissions_pb";
import { useAppDispatch, useAppSelector } from "@/app/hooks";
import { SubjectAvatarById } from "@/components/subject/SubjectAvatar";
import { Button } from "@/components/ui/button";
import { Modal, ModalBody, ModalFooter, ModalHeader } from "@/components/ui/modal";
import { ReasonDialog } from "@/components/ui/reason-dialog";
import { getContentTypeConfig } from "@/config/theme/contentTypes";
import { ContentRoleSelect } from "@/features/permissions/components/ContentRoleSelect";
import { useContentMembers } from "@/features/permissions/hooks/useContentMembers";
import {
  fetchAccessRequest,
  respondToAccessRequest,
} from "@/features/permissions/store/accessRequestThunks";
import type { SerializedAccessRequest } from "@/features/permissions/store/accessRequestsSlice";
import { formatSmartDateTime } from "@/shared/utils/dateFormatting";
import { cn } from "@/shared/utils/cn";
import { parseUrn } from "@/shared/utils/urn";

interface AccessRequestReviewDialogProps {
  requestId: string;
  onClose: () => void;
}

function grantTargetCopy(request: SerializedAccessRequest): string {
  if (
    request.originalContentType === ContentType.TASK &&
    request.canonicalContentType === ContentType.PROJECT
  ) {
    return "Approval grants access to the project that contains this task.";
  }
  if (
    request.originalContentType === ContentType.CHAT_MESSAGE &&
    request.canonicalContentType === ContentType.CHAT
  ) {
    return "Approval adds this person to the private channel that contains the message.";
  }
  if (request.canonicalContentType === ContentType.CHAT) {
    return "Approval adds this person as an ordinary member of the private channel.";
  }
  return "Approval grants access to this resource through its existing access policy.";
}

function StandardGrantControls({
  request,
  role,
  onRoleChange,
  disabled,
}: {
  request: SerializedAccessRequest;
  role: ContentRole;
  onRoleChange: (role: ContentRole) => void;
  disabled: boolean;
}) {
  const { policy, loading } = useContentMembers(
    request.canonicalContentType,
    request.canonicalContentId,
  );
  const effectiveAccessMode = policy?.effectiveAccessMode ?? policy?.accessMode;
  const isPersonal = effectiveAccessMode === AccessMode.OWNER_ONLY;

  return (
    <div className="space-y-3">
      <div>
        <label className="block text-sm text-muted-foreground mb-1">Access level</label>
        <ContentRoleSelect
          value={role}
          onChange={onRoleChange}
          excludeRoles={[ContentRole.OWNER, ContentRole.BLOCKED]}
          disabled={disabled || loading}
          size="md"
          className="w-full"
        />
      </div>
      {isPersonal && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-100 p-3 text-xs leading-relaxed text-amber-800 dark:bg-amber-900/30 dark:text-amber-400">
          This item is Personal. Approval changes it to Invited people before granting access.
        </div>
      )}
    </div>
  );
}

function terminalStateCopy(request: SerializedAccessRequest) {
  switch (request.state) {
    case AccessRequestState.APPROVED:
      return {
        icon: CheckCircle,
        title: "Access granted",
        body: request.approvedRole
          ? `This request was approved with ${ContentRole[request.approvedRole].toLowerCase()} access.`
          : "This request was approved and channel membership was granted.",
        className:
          "border-green-500/30 bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",
      };
    case AccessRequestState.DENIED:
      return {
        icon: Prohibit,
        title: "Request denied",
        body: request.decisionNote || "This request was denied without a note.",
        className: "border-red-500/30 bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400",
      };
    case AccessRequestState.CANCELED:
      return {
        icon: Clock,
        title: "Request canceled",
        body: "The requester canceled this request before it was reviewed.",
        className: "border-border bg-muted/50 text-muted-foreground",
      };
    default:
      return null;
  }
}

export function AccessRequestReviewDialog({ requestId, onClose }: AccessRequestReviewDialogProps) {
  const dispatch = useAppDispatch();
  const request = useAppSelector((state) => state.accessRequests.byId[requestId]);
  const loading = useAppSelector((state) => state.accessRequests.loadingById[requestId] ?? false);
  const responding = useAppSelector(
    (state) => state.accessRequests.respondingById[requestId] ?? false,
  );
  const error = useAppSelector((state) => state.accessRequests.errorsById[requestId] ?? null);
  const [role, setRole] = useState(ContentRole.VIEWER);
  const [denyOpen, setDenyOpen] = useState(false);

  useEffect(() => {
    void dispatch(fetchAccessRequest({ requestId }));
  }, [dispatch, requestId]);

  const approve = async () => {
    if (!request) return;
    const isChat = request.canonicalContentType === ContentType.CHAT;
    try {
      await dispatch(
        respondToAccessRequest({
          requestId,
          decision: AccessRequestDecision.APPROVE,
          approvedRole: isChat ? undefined : role,
        }),
      ).unwrap();
    } catch {
      return;
    }
  };

  const deny = async (decisionNote: string) => {
    try {
      await dispatch(
        respondToAccessRequest({
          requestId,
          decision: AccessRequestDecision.DENY,
          decisionNote,
        }),
      ).unwrap();
      setDenyOpen(false);
    } catch {
      return;
    }
  };

  const parsed = request ? parseUrn(request.requestedUrn) : null;
  const typeConfig = parsed ? getContentTypeConfig(parsed.type) : null;
  const TypeIcon = typeConfig?.icon ?? LockKeyOpen;
  const isPending = request?.state === AccessRequestState.PENDING;
  const isChat = request?.canonicalContentType === ContentType.CHAT;
  const terminal = request ? terminalStateCopy(request) : null;

  return (
    <>
      <Modal onClose={onClose} closeDisabled={responding} maxWidth="max-w-md">
        <ModalHeader title="Review access request" />

        <ModalBody>
          {loading && !request ? (
            <div className="space-y-3" aria-label="Loading access request">
              <div className="h-16 animate-pulse rounded-lg bg-muted" />
              <div className="h-24 animate-pulse rounded-lg bg-muted" />
            </div>
          ) : error && !request ? (
            <div className="rounded-lg border border-border bg-muted/40 p-3 text-sm text-muted-foreground">
              This request is no longer available to review. It may be stale, removed, or assigned
              to another manager.
            </div>
          ) : request && typeConfig ? (
            <>
              <div className="flex items-center gap-3 rounded-lg border border-border bg-muted/30 p-3">
                <SubjectAvatarById
                  userId={request.requesterId}
                  displayName={request.requesterDisplayName}
                  size="lg"
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-foreground">
                    {request.requesterDisplayName || "Organization member"}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Requested {formatSmartDateTime(request.createdAt ?? undefined)}
                  </p>
                </div>
              </div>

              <div
                className={cn(
                  "rounded-lg border p-3",
                  typeConfig.theme.border,
                  typeConfig.theme.badgeBg,
                )}
              >
                <div className="flex items-center gap-3">
                  <span
                    className={cn(
                      "grid h-9 w-9 shrink-0 place-items-center rounded-lg",
                      typeConfig.theme.iconBoxAccent,
                    )}
                  >
                    <TypeIcon size={18} weight="duotone" />
                  </span>
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-foreground">{typeConfig.label} access</p>
                    <p className="text-xs text-muted-foreground">{grantTargetCopy(request)}</p>
                  </div>
                </div>
              </div>

              {request.message && (
                <div>
                  <p className="mb-1.5 text-xs font-medium text-muted-foreground">
                    Requester message
                  </p>
                  <p className="whitespace-pre-wrap break-words rounded-lg bg-muted/50 p-3 text-sm leading-relaxed text-foreground">
                    {request.message}
                  </p>
                </div>
              )}

              {isPending && isChat && (
                <div className="flex items-start gap-3 rounded-lg border border-border bg-muted/30 p-3">
                  <ChatCircle size={18} weight="duotone" className="mt-0.5 shrink-0 text-primary" />
                  <p className="text-sm leading-relaxed text-muted-foreground">
                    Approval adds this person as an ordinary channel member. It does not grant a
                    moderator or owner role.
                  </p>
                </div>
              )}

              {isPending && !isChat && (
                <StandardGrantControls
                  request={request}
                  role={role}
                  onRoleChange={setRole}
                  disabled={responding}
                />
              )}

              {terminal && (
                <div className={cn("rounded-lg border p-3", terminal.className)}>
                  <div className="flex items-start gap-3">
                    <terminal.icon size={18} weight="duotone" className="mt-0.5 shrink-0" />
                    <div>
                      <p className="text-sm font-medium">{terminal.title}</p>
                      <p className="mt-1 whitespace-pre-wrap break-words text-sm leading-relaxed opacity-90">
                        {terminal.body}
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {error && request && (
                <p
                  role="alert"
                  className="rounded-lg border border-red-500/30 bg-red-100 px-3 py-2 text-sm text-red-800 dark:bg-red-900/30 dark:text-red-400"
                >
                  The response could not be saved. The request remains pending and is safe to retry.
                </p>
              )}
            </>
          ) : null}
        </ModalBody>

        <ModalFooter>
          <Button variant="ghost" onClick={onClose} disabled={responding}>
            Close
          </Button>
          {isPending && (
            <>
              <Button variant="outline" onClick={() => setDenyOpen(true)} disabled={responding}>
                <Prohibit size={14} weight="duotone" />
                Deny
              </Button>
              <Button onClick={() => void approve()} loading={responding}>
                <CheckCircle size={14} weight="duotone" />
                Approve
              </Button>
            </>
          )}
        </ModalFooter>
      </Modal>

      <ReasonDialog
        isOpen={denyOpen}
        onClose={() => {
          if (!responding) setDenyOpen(false);
        }}
        onConfirm={(reason) => void deny(reason)}
        title="Deny access request?"
        description="The requester will be notified. You can include a short reason."
        reasonLabel="Reason"
        reasonPlaceholder="Optional note for the requester"
        reasonRequired={false}
        confirmLabel="Deny request"
        variant="danger"
        loading={responding}
      />
    </>
  );
}
