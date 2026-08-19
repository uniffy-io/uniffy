import { useEffect, useState } from "react";
import { CheckCircle, Clock, LockKey, PaperPlaneTilt, Prohibit, X } from "@phosphor-icons/react";
import {
  AccessRequestState,
  RequestAccessOutcome,
} from "@uniffy/proto/permissions/v1/permissions_pb";
import { useAppDispatch, useAppSelector } from "@/app/hooks";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { getContentTypeConfig } from "@/config/theme/contentTypes";
import {
  cancelAccessRequest,
  fetchMyAccessRequestStatuses,
  requestContentAccess,
} from "@/features/permissions/store/accessRequestThunks";
import {
  clearAccessRequestError,
  type RequestAccessDialogTarget,
} from "@/features/permissions/store/accessRequestsSlice";
import { formatSmartDateTime } from "@/shared/utils/dateFormatting";
import { cn } from "@/shared/utils/cn";
import { parseUrn } from "@/shared/utils/urn";

interface RequestAccessDialogProps {
  target: RequestAccessDialogTarget;
  onClose: () => void;
}

function cooldownIsActive(canRequestAgainAt: string | null): boolean {
  return !!canRequestAgainAt && new Date(canRequestAgainAt).getTime() > Date.now();
}

export function RequestAccessDialog({ target, onClose }: RequestAccessDialogProps) {
  const dispatch = useAppDispatch();
  const [message, setMessage] = useState("");
  const status = useAppSelector((state) => state.accessRequests.byUrn[target.urn]);
  const isRequesting = useAppSelector(
    (state) => state.accessRequests.requestingByUrn[target.urn] ?? false,
  );
  const requestError = useAppSelector(
    (state) => state.accessRequests.requestErrorsByUrn[target.urn] ?? null,
  );
  const isCanceling = useAppSelector((state) =>
    status?.requestId ? (state.accessRequests.respondingById[status.requestId] ?? false) : false,
  );

  const { type } = parseUrn(target.urn);
  const config = getContentTypeConfig(type);
  const TargetIcon = config.icon;
  const isPending = status?.state === AccessRequestState.PENDING;
  const isDenied = status?.state === AccessRequestState.DENIED;
  const isCanceled = status?.state === AccessRequestState.CANCELED;
  const isApproved = status?.requesterHasAccess ?? false;
  const cooldownActive = isDenied && cooldownIsActive(status.canRequestAgainAt);
  const isBusy = isRequesting || isCanceling;

  useEffect(() => {
    void dispatch(fetchMyAccessRequestStatuses({ requestedUrns: [target.urn] }));
  }, [dispatch, target.urn]);

  const handleRequest = async () => {
    dispatch(clearAccessRequestError(target.urn));
    try {
      const result = await dispatch(
        requestContentAccess({ requestedUrn: target.urn, message }),
      ).unwrap();
      if (result.outcome === RequestAccessOutcome.ALREADY_ACCESSIBLE) onClose();
    } catch {
      return;
    }
  };

  const handleCancel = async () => {
    if (!status?.requestId) return;
    try {
      await dispatch(cancelAccessRequest({ requestId: status.requestId })).unwrap();
    } catch {
      return;
    }
  };

  return (
    <Modal onClose={onClose} closeDisabled={isBusy} maxWidth="max-w-md">
      <div className="flex items-start gap-3 p-4 border-b border-border">
        <div className="p-2 rounded-lg bg-primary/10 shrink-0">
          <LockKey size={20} weight="duotone" className="text-primary" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-base font-semibold text-foreground">Request access</div>
          <div className="text-xs text-muted-foreground mt-0.5 truncate">{target.label}</div>
        </div>
        <button
          type="button"
          onClick={onClose}
          disabled={isBusy}
          className="text-muted-foreground hover:text-foreground"
          aria-label="Close"
        >
          <X size={16} weight="bold" />
        </button>
      </div>

      <div className="p-4 space-y-4">
        <div
          className={cn(
            "flex items-center gap-3 rounded-lg border p-3",
            config.theme.border,
            config.theme.badgeBg,
          )}
        >
          <span
            className={cn(
              "grid h-9 w-9 shrink-0 place-items-center rounded-lg",
              config.theme.iconBoxAccent,
            )}
          >
            <TargetIcon size={18} weight="duotone" />
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-foreground">{target.label}</p>
            <p className="text-xs text-muted-foreground">Restricted {config.label.toLowerCase()}</p>
          </div>
        </div>

        {isPending ? (
          <div className="rounded-lg border border-border bg-muted/40 p-3">
            <div className="flex items-start gap-3">
              <Clock size={18} weight="duotone" className="mt-0.5 shrink-0 text-primary" />
              <div>
                <p className="text-sm font-medium text-foreground">Access requested</p>
                <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                  People who manage this resource have been notified. You can cancel while the
                  request is pending.
                </p>
              </div>
            </div>
          </div>
        ) : isApproved ? (
          <div className="rounded-lg border border-green-500/30 bg-green-100 p-3 text-green-800 dark:bg-green-900/30 dark:text-green-400">
            <div className="flex items-start gap-3">
              <CheckCircle size={18} weight="duotone" className="mt-0.5 shrink-0" />
              <div>
                <p className="text-sm font-medium">Access granted</p>
                <p className="mt-1 text-sm leading-relaxed opacity-90">
                  This mention is refreshing and will become available shortly.
                </p>
              </div>
            </div>
          </div>
        ) : cooldownActive ? (
          <div className="rounded-lg border border-red-500/30 bg-red-100 p-3 text-red-800 dark:bg-red-900/30 dark:text-red-400">
            <div className="flex items-start gap-3">
              <Prohibit size={18} weight="duotone" className="mt-0.5 shrink-0" />
              <div>
                <p className="text-sm font-medium">Request denied</p>
                <p className="mt-1 text-sm leading-relaxed opacity-90">
                  You can send another request{" "}
                  {formatSmartDateTime(status.canRequestAgainAt ?? undefined)}.
                </p>
              </div>
            </div>
          </div>
        ) : (
          <>
            <div>
              <label
                htmlFor="access-request-message"
                className="block text-xs font-medium text-muted-foreground"
              >
                Add a message <span className="font-normal">(optional)</span>
              </label>
              <textarea
                id="access-request-message"
                value={message}
                onChange={(event) => setMessage(event.target.value.slice(0, 500))}
                maxLength={500}
                rows={4}
                placeholder="Share why you need access"
                disabled={isBusy || !target.canRequestAccess}
                className="mt-2 w-full resize-none rounded-lg border border-input bg-background px-3 py-2.5 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
              />
              <div className="mt-1 flex items-center justify-between gap-3 text-xs text-muted-foreground">
                <span>Resource details stay private until access is granted.</span>
                <span className="shrink-0 tabular-nums">{message.length}/500</span>
              </div>
            </div>

            {isCanceled && (
              <p className="rounded-lg bg-muted/50 px-3 py-2 text-sm text-muted-foreground">
                Your previous request was canceled. You can send a new one.
              </p>
            )}

            {!target.canRequestAccess && (
              <p className="rounded-lg bg-muted/50 px-3 py-2 text-sm text-muted-foreground">
                Access requests are not available for this resource type.
              </p>
            )}

            {requestError && (
              <p
                role="alert"
                className="rounded-lg border border-red-500/30 bg-red-100 px-3 py-2 text-sm text-red-800 dark:bg-red-900/30 dark:text-red-400"
              >
                We could not send the request. Check your connection and try again.
              </p>
            )}
          </>
        )}
      </div>

      <div className="flex items-center justify-end gap-2 p-4 border-t border-border">
        {isPending ? (
          <>
            <Button variant="ghost" size="md" onClick={onClose} disabled={isBusy}>
              Close
            </Button>
            <Button
              variant="destructive"
              size="md"
              onClick={() => void handleCancel()}
              loading={isCanceling}
            >
              Cancel request
            </Button>
          </>
        ) : isApproved || cooldownActive || !target.canRequestAccess ? (
          <Button variant="ghost" size="md" onClick={onClose}>
            Close
          </Button>
        ) : (
          <>
            <Button variant="ghost" size="md" onClick={onClose} disabled={isBusy}>
              Cancel
            </Button>
            <Button size="md" onClick={() => void handleRequest()} loading={isRequesting}>
              <PaperPlaneTilt size={14} weight="duotone" />
              Send request
            </Button>
          </>
        )}
      </div>
    </Modal>
  );
}
