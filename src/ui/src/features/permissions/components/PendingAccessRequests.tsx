import { useEffect } from "react";
import { Clock, LockKey, WarningCircle } from "@phosphor-icons/react";
import { ContentType } from "@uniffy/proto/common/v1/common_pb";
import { AccessRequestState } from "@uniffy/proto/permissions/v1/permissions_pb";
import { useAppDispatch, useAppSelector } from "@/app/hooks";
import { SubjectAvatarById } from "@/components/subject/SubjectAvatar";
import { Button } from "@/components/ui/button";
import { getContentTypeConfig } from "@/config/theme/contentTypes";
import { listAccessRequests } from "@/features/permissions/store/accessRequestThunks";
import { openAccessRequestReviewDialog } from "@/features/permissions/store/accessRequestsSlice";
import { formatRelativeTime } from "@/shared/utils/dateFormatting";
import { cn } from "@/shared/utils/cn";
import { parseUrn } from "@/shared/utils/urn";

interface PendingAccessRequestsProps {
  canonicalContentType: ContentType | number;
  canonicalContentId: string;
  className?: string;
  /** One rung above the host: `surface` on an app-frame page, `card` inside a dialog. */
  tone?: "card" | "surface";
}

export function PendingAccessRequests({
  canonicalContentType,
  canonicalContentId,
  className,
  tone = "card",
}: PendingAccessRequestsProps) {
  const pane = tone === "surface" ? "bg-surface" : "bg-card";
  const dispatch = useAppDispatch();
  const targetKey = `${canonicalContentType}:${canonicalContentId}`;
  const list = useAppSelector((state) => state.accessRequests.listsByTarget[targetKey]);
  const requests = useAppSelector((state) =>
    (state.accessRequests.listsByTarget[targetKey]?.ids ?? [])
      .map((id) => state.accessRequests.byId[id])
      .filter((request) => request?.state === AccessRequestState.PENDING),
  );

  useEffect(() => {
    void dispatch(
      listAccessRequests({
        canonicalContentType: canonicalContentType as ContentType,
        canonicalContentId,
        state: AccessRequestState.PENDING,
        page: 1,
        pageSize: 10,
      }),
    );
  }, [canonicalContentId, canonicalContentType, dispatch]);

  if (list?.loading && requests.length === 0) {
    return (
      <div className={cn("space-y-2", className)} aria-label="Loading pending access requests">
        <div className="h-16 animate-pulse rounded-lg bg-muted" />
        <div className="h-16 animate-pulse rounded-lg bg-muted" />
      </div>
    );
  }

  if (list?.error && requests.length === 0) {
    return (
      <div
        className={cn(
          "flex items-start gap-2 rounded-xl p-3 text-sm text-muted-foreground shadow-edge",
          pane,
          className,
        )}
      >
        <WarningCircle size={18} weight="duotone" className="mt-0.5 shrink-0" />
        Pending requests could not be loaded. Try reopening this panel.
      </div>
    );
  }

  if (requests.length === 0) {
    return (
      <div
        className={cn(
          "rounded-xl px-3 py-4 text-center text-sm text-muted-foreground shadow-edge",
          pane,
          className,
        )}
      >
        No pending access requests
      </div>
    );
  }

  return (
    <div className={cn("space-y-2", className)}>
      {requests.map((request) => {
        const parsed = parseUrn(request.requestedUrn);
        const config = getContentTypeConfig(parsed.type);
        const TypeIcon = config.icon;
        return (
          <div
            key={request.id}
            className={cn(
              "flex flex-col gap-3 rounded-xl p-3 shadow-edge sm:flex-row sm:items-center",
              pane,
            )}
          >
            <div className="flex min-w-0 flex-1 items-center gap-3">
              <SubjectAvatarById
                userId={request.requesterId}
                displayName={request.requesterDisplayName}
                size="md"
              />
              <div className="min-w-0 flex-1">
                <div className="flex min-w-0 items-center gap-1.5">
                  <p className="truncate text-sm font-medium text-foreground">
                    {request.requesterDisplayName || "Organization member"}
                  </p>
                  <span
                    className={cn(
                      "inline-flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium",
                      config.theme.badgeBg,
                      config.theme.accentText,
                    )}
                  >
                    <TypeIcon size={10} weight="duotone" />
                    {config.label}
                  </span>
                </div>
                <div className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
                  <Clock size={11} weight="duotone" />
                  {formatRelativeTime(request.createdAt ?? undefined)}
                </div>
                {request.message && (
                  <p className="mt-1 line-clamp-1 text-xs text-muted-foreground">
                    {request.message}
                  </p>
                )}
              </div>
            </div>
            <Button
              variant="outline"
              size="md"
              onClick={() => dispatch(openAccessRequestReviewDialog(request.id))}
              className="shrink-0"
            >
              <LockKey size={14} weight="duotone" />
              Review
            </Button>
          </div>
        );
      })}
    </div>
  );
}
