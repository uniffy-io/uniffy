import { memo, useState, useRef, useMemo, useEffect, type RefObject } from "react";
import { createPortal } from "react-dom";
import { ArrowClockwise, CaretDown, Clock, LockKey, Prohibit, Trash } from "@phosphor-icons/react";
import { parseUrn, getUrnTypeLabel, UrnType } from "@/shared/utils/urn";
import { buildFileUrl, buildMediaUrl } from "@/shared/utils/fileUrls";
import { MentionPreview } from "@/components/mention/MentionPreview";
import { MentionExpandedCard } from "@/components/mention/MentionExpandedCard";
import { MetaSeparator } from "@/components/mention/previews/ParentBadge";
import { buildLiveStateFromMetadata } from "@/components/mention/buildLiveState";
import {
  hasExpandedCard,
  isPeopleTokenType,
  peopleTokenClasses,
} from "@/components/mention/mentionConstants";
import { useUrnPreview } from "@/components/editor/plugins/mention/useUrnPreview";
import { getContentTypeConfig } from "@/config/theme/contentTypes";
import { useAppDispatch, useAppSelector } from "@/app/hooks";
import { LiveIndicator } from "@/components/mention/LiveIndicators";
import {
  isTaskDoneStatus,
  MentionAccessRequestStatus,
  MentionAvailability,
} from "@/components/mention/types";
import { useMentionState, useMentionDisplay } from "@/components/mention/useMentionState";
import { mentionStatusToAccessRequestState } from "@/components/mention/accessRequestState";
import { resolveUrnBatched } from "@/components/mention/useBatchedSubjectResolver";
import { openRequestAccessDialog } from "@/features/permissions/store/accessRequestsSlice";
import { cn } from "@/shared/utils/cn";
import type { Icon } from "@phosphor-icons/react";
import type {
  MentionChipProps,
  MentionChipCompactProps,
  MentionLiveState,
} from "@/components/mention/types";

const HOVER_DELAY = 200;
const CLOSE_DELAY = 350;

function useTimeoutCleanup(...refs: RefObject<ReturnType<typeof setTimeout> | null>[]) {
  useEffect(() => {
    return () => {
      for (const ref of refs) {
        if (ref.current) clearTimeout(ref.current);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

/** localStorage key prefix for the per-surface, per-URN expand/collapse preference. */
const TOGGLE_STORAGE_PREFIX = "mention-toggle:";

/** Surface the chip lives on (chat, notes, calendar, ...) so a toggle in one place
 *  never leaks into another; derived from the route since chips render under it. */
function toggleScope(): string {
  if (typeof window === "undefined") return "app";
  return window.location.pathname.split("/")[1] || "app";
}

function readToggle(urn: string): boolean | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(TOGGLE_STORAGE_PREFIX + toggleScope() + ":" + urn);
    if (raw === "true") return true;
    if (raw === "false") return false;
    return null;
  } catch {
    return null;
  }
}

function writeToggle(urn: string, value: boolean): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(TOGGLE_STORAGE_PREFIX + toggleScope() + ":" + urn, String(value));
  } catch {
    // Quota / private mode -- ignore.
  }
}

/** Reserves the expanded-card footprint so chips don't shift size when liveState arrives. */
function MentionExpandedCardSkeleton({ label }: { label: string }) {
  return (
    <span
      aria-busy="true"
      aria-label={`Loading ${label}`}
      className={cn(
        "mention-expanded-card not-prose relative block",
        "w-full max-w-md my-2 px-4 py-3",
        "bg-card",
        "rounded-lg border border-border shadow-xs",
        "overflow-hidden",
      )}
    >
      <span className="flex items-start gap-3 animate-pulse">
        <span className="grid place-items-center shrink-0 w-10 h-10 rounded-lg bg-muted" />
        <span className="block flex-1 min-w-0 pt-1 space-y-2">
          <span className="block h-3.5 w-3/4 rounded bg-muted" />
          <span className="block h-2.5 w-1/3 rounded bg-muted" />
          <span className="block h-2.5 w-full rounded bg-muted/60" />
          <span className="block h-2.5 w-5/6 rounded bg-muted/60" />
        </span>
      </span>
    </span>
  );
}

function MentionTombstoneChip({
  typeLabel,
  compact = false,
}: {
  typeLabel: string;
  compact?: boolean;
}) {
  // Drop the original label intentionally: a deleted reference should reveal only the type, not the content.
  const labelText = `Deleted ${typeLabel.toLowerCase()}`;
  return (
    <span
      role="img"
      aria-label={labelText}
      title={labelText}
      className={cn(
        "mention-chip-tombstone inline-flex items-center align-middle",
        "rounded-md border border-dashed border-muted-foreground/40",
        "bg-muted/40 text-muted-foreground",
        "select-none cursor-not-allowed",
        compact ? "gap-1 px-1.5 py-0.5 mx-0.5 text-xs" : "gap-1.5 px-2 py-1 mx-0.5 my-0.5",
      )}
    >
      <span
        className={cn(
          "grid place-items-center shrink-0 rounded",
          compact ? "w-3.5 h-3.5" : "w-5 h-5",
          "bg-muted-foreground/10 text-muted-foreground/70",
        )}
      >
        <Trash size={compact ? 8 : 11} weight="duotone" />
      </span>
      <span className={cn("font-medium italic", compact ? "text-xs" : "text-sm")}>{labelText}</span>
    </span>
  );
}

function MentionTombstoneCard({ typeLabel }: { typeLabel: string }) {
  const heading = `Deleted ${typeLabel.toLowerCase()}`;
  return (
    <span
      role="img"
      aria-label={heading}
      className={cn(
        "mention-expanded-card not-prose relative block",
        "w-full max-w-md my-2 px-4 py-3",
        "bg-muted/40 text-muted-foreground",
        "rounded-lg border border-dashed border-muted-foreground/40 shadow-xs",
        "cursor-not-allowed select-none",
      )}
      title={heading}
    >
      <span className="flex items-start gap-3">
        <span className="grid place-items-center shrink-0 w-10 h-10 rounded-lg bg-muted-foreground/10 text-muted-foreground/70">
          <Trash size={18} weight="duotone" />
        </span>
        <span className="block flex-1 min-w-0 pt-0.5">
          <span className="block font-semibold text-sm italic text-foreground/70">{heading}</span>
          <span className="block mt-1.5 text-xs text-muted-foreground leading-relaxed">
            This reference no longer points to a live item. The original content was removed.
          </span>
        </span>
      </span>
    </span>
  );
}

function restrictedAction(
  status: MentionAccessRequestStatus | undefined,
  canRequestAgainAt: string | undefined,
): { label: string; icon: Icon } {
  if (status === MentionAccessRequestStatus.Pending) {
    return { label: "Access requested", icon: Clock };
  }
  if (
    status === MentionAccessRequestStatus.Denied &&
    canRequestAgainAt &&
    new Date(canRequestAgainAt).getTime() > Date.now()
  ) {
    return { label: "Request denied", icon: Prohibit };
  }
  return { label: "Request access", icon: LockKey };
}

interface MentionRestrictedProps {
  urn: string;
  label: string;
  typeLabel: string;
  style: TypeStyle;
  compact?: boolean;
  expanded?: boolean;
  liveState: MentionLiveState;
}

function MentionRestricted({
  urn,
  label,
  typeLabel,
  style,
  compact = false,
  expanded = false,
  liveState,
}: MentionRestrictedProps) {
  const dispatch = useAppDispatch();
  const canRequestAccess = liveState.canRequestAccess ?? false;
  const action = restrictedAction(liveState.accessRequestStatus, liveState.canRequestAgainAt);
  const ActionIcon = action.icon;

  const openDialog = () => {
    dispatch(
      openRequestAccessDialog({
        urn,
        label,
        canRequestAccess,
        state: mentionStatusToAccessRequestState(liveState.accessRequestStatus),
        requestId: liveState.accessRequestId,
        canRequestAgainAt: liveState.canRequestAgainAt,
      }),
    );
  };

  if (expanded) {
    return (
      <span className="mention-expanded-card mention-chip-restricted not-prose relative block w-full max-w-md my-2 bg-card text-card-foreground rounded-lg shadow-xs border border-border overflow-hidden">
        <span className="block relative px-4 pt-3 pb-1 pl-5">
          <span className="flex items-center gap-2.5">
            <span
              className={cn(
                "grid place-items-center shrink-0 w-7 h-7 rounded-md",
                style.iconBoxAccent,
              )}
            >
              <LockKey size={16} weight="duotone" />
            </span>
            <span className="block flex-1 min-w-0">
              <span className="block font-semibold text-sm truncate">{label}</span>
              <span className="flex items-center gap-1.5 flex-wrap">
                <span className="text-[10px] font-medium text-primary">{typeLabel}</span>
                <MetaSeparator />
                <span className="text-[10px] text-muted-foreground">Restricted</span>
              </span>
            </span>
          </span>
        </span>

        <span className="block px-4 pb-2 pl-[3.375rem]">
          <span className="block text-xs text-muted-foreground/70 leading-relaxed">
            You do not have access to this resource. Its details remain private until access is
            granted.
          </span>
        </span>

        <span className="flex px-4 py-1.5 pl-5 bg-muted/30 border-t border-border/50 items-center justify-between">
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <LockKey size={12} weight="duotone" />
            <span>Private</span>
          </span>
          {canRequestAccess && (
            <button
              type="button"
              onClick={openDialog}
              className="inline-flex cursor-pointer items-center gap-1 rounded-md px-1.5 py-0.5 text-xs text-muted-foreground/70 transition-colors hover:bg-muted hover:text-foreground"
            >
              <ActionIcon size={11} weight="bold" />
              <span>{action.label}</span>
            </button>
          )}
        </span>
      </span>
    );
  }

  const content = (
    <>
      <span
        className={cn(
          "grid shrink-0 place-items-center rounded",
          compact ? "h-3.5 w-3.5" : "h-5 w-5",
          style.iconBoxAccent,
        )}
      >
        <LockKey size={compact ? 8 : 11} weight="duotone" />
      </span>
      <span
        className={cn(
          "truncate font-medium text-foreground",
          compact ? "max-w-[100px] text-xs" : "text-sm",
        )}
      >
        {label}
      </span>
      <span
        className={cn(
          "inline-flex shrink-0 items-center gap-1 text-muted-foreground",
          compact ? "text-[10px]" : "text-xs",
        )}
      >
        {canRequestAccess && <ActionIcon size={compact ? 10 : 12} weight="duotone" />}
        {canRequestAccess ? action.label : "Restricted"}
      </span>
    </>
  );

  const classes = cn(
    compact
      ? "mention-chip-compact gap-1 px-1.5 py-0.5 mx-0.5"
      : "mention-chip gap-1.5 px-2 py-1 mx-0.5 my-0.5",
    "mention-chip-restricted inline-flex items-center align-middle rounded-md border select-none",
    style.badgeBg,
    style.border,
    canRequestAccess && "cursor-pointer transition-colors hover:bg-muted",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
  );

  return canRequestAccess ? (
    <button
      type="button"
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        openDialog();
      }}
      onMouseDown={(event) => event.stopPropagation()}
      className={classes}
      aria-label={`${action.label} for ${typeLabel}: ${label}`}
    >
      {content}
    </button>
  ) : (
    <span className={classes} aria-label={`Restricted ${typeLabel}: ${label}`}>
      {content}
    </span>
  );
}

interface MentionUnavailableProps {
  urn: string;
  label: string;
  typeLabel: string;
  organizationId: string | null | undefined;
  compact?: boolean;
  expanded?: boolean;
}

function MentionUnavailable({
  urn,
  label,
  typeLabel,
  organizationId,
  compact = false,
  expanded = false,
}: MentionUnavailableProps) {
  const [retrying, setRetrying] = useState(false);

  const retry = async () => {
    if (!organizationId || retrying) return;
    setRetrying(true);
    try {
      await resolveUrnBatched(urn, organizationId, { force: true });
    } catch {
      // The unavailable state remains visible and offers another bounded retry.
    } finally {
      setRetrying(false);
    }
  };

  if (expanded) {
    return (
      <span className="mention-expanded-card mention-chip-unavailable not-prose relative block w-full max-w-md my-2 bg-card text-card-foreground rounded-lg shadow-xs border border-border overflow-hidden">
        <span className="block relative px-4 pt-3 pb-1 pl-5">
          <span className="flex items-center gap-2.5">
            <span className="grid place-items-center shrink-0 w-7 h-7 rounded-md bg-muted text-muted-foreground">
              <ArrowClockwise
                size={16}
                weight="duotone"
                className={retrying ? "animate-spin" : undefined}
              />
            </span>
            <span className="block flex-1 min-w-0">
              <span className="block font-semibold text-sm truncate">{label}</span>
              <span className="flex items-center gap-1.5 flex-wrap">
                <span className="text-[10px] font-medium text-primary">{typeLabel}</span>
                <MetaSeparator />
                <span className="text-[10px] text-muted-foreground">Unavailable</span>
              </span>
            </span>
          </span>
        </span>

        <span className="block px-4 pb-2 pl-[3.375rem]">
          <span className="block text-xs text-muted-foreground/70 leading-relaxed">
            This {typeLabel.toLowerCase()} could not be checked right now. Try again before assuming
            it was removed.
          </span>
        </span>

        <span className="flex px-4 py-1.5 pl-5 bg-muted/30 border-t border-border/50 items-center justify-end">
          <button
            type="button"
            onClick={() => void retry()}
            disabled={!organizationId || retrying}
            className="inline-flex cursor-pointer items-center gap-1 rounded-md px-1.5 py-0.5 text-xs text-muted-foreground/70 transition-colors hover:bg-muted hover:text-foreground disabled:cursor-default disabled:opacity-40"
          >
            <ArrowClockwise
              size={11}
              weight="bold"
              className={retrying ? "animate-spin" : undefined}
            />
            <span>Retry</span>
          </button>
        </span>
      </span>
    );
  }

  return (
    <span
      className={cn(
        "mention-chip-unavailable inline-flex items-center align-middle rounded-md border border-border bg-muted/30 text-muted-foreground",
        compact ? "gap-1 px-1.5 py-0.5 mx-0.5 text-xs" : "gap-1.5 px-2 py-1 mx-0.5 my-0.5",
      )}
    >
      <ArrowClockwise
        size={compact ? 10 : 13}
        weight="duotone"
        className={retrying ? "animate-spin" : undefined}
      />
      <span className={cn("truncate font-medium text-foreground", compact && "max-w-[100px]")}>
        {label}
      </span>
      <button
        type="button"
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          void retry();
        }}
        onMouseDown={(event) => event.stopPropagation()}
        disabled={!organizationId || retrying}
        className="rounded px-1 py-0.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-40"
        aria-label={`Retry ${typeLabel}: ${label}`}
      >
        Retry
      </button>
    </span>
  );
}

interface TypeStyle {
  icon: Icon;
  iconBoxAccent: string;
  border: string;
  borderHover: string;
  badgeBg: string;
}

function getTypeStyle(type: UrnType): TypeStyle {
  const config = getContentTypeConfig(type);
  const theme = config.theme;
  return {
    icon: config.icon,
    iconBoxAccent: theme.iconBoxAccent,
    border: theme.border,
    borderHover: theme.borderHover,
    badgeBg: theme.badgeBg,
  };
}

function isLiveContent(updatedAt?: string): boolean {
  if (!updatedAt) return false;
  return Date.now() - new Date(updatedAt).getTime() < 60_000;
}

/** Which live fields earn a pulse dot. The compact chip has no room for the
 *  file and project ones, so it opts out of those two. */
function hasLiveIndicator(
  urnType: UrnType,
  live: MentionLiveState | null,
  compact = false,
): boolean {
  if (!live) return false;
  switch (urnType) {
    case UrnType.TASK:
      return !!live.taskStatus;
    case UrnType.CALENDAR_EVENT:
      return !!live.eventStartTime;
    case UrnType.NOTE:
      return !!live.noteIsBeingEdited;
    case UrnType.FILE:
      return !compact && !!live.fileProcessingStatus;
    case UrnType.PROJECT:
      return !compact && (live.projectTotalTasks ?? 0) > 0;
    default:
      return false;
  }
}

function MentionChipInner({
  urn,
  label,
  selected = false,
  onClick,
  onReplaceWithMedia,
  liveState,
}: MentionChipProps) {
  const { type: urnType, id: urnId, isValid: isValidUrn } = parseUrn(urn);
  const style = getTypeStyle(urnType);
  const typeLabel = getUrnTypeLabel(urn);
  const TypeIcon = style.icon;
  const organizationId = useAppSelector((state) => state.auth.currentOrganizationId);
  const currentUserId = useAppSelector((state) => state.auth.user?.id);
  const isPeopleToken = isPeopleTokenType(urnType);
  const isSelfMention = urnType === UrnType.USER && !!urnId && urnId === currentUserId;

  const contextState = useMentionState(urn);

  const { preview, isLoading, error, fetchPreview } = useUrnPreview();

  const mentionDisplay = useMentionDisplay();
  const defaultExpanded = mentionDisplay !== "compact";

  const canExpand = hasExpandedCard(urnType);

  const resolvedLiveState = useMemo((): MentionLiveState | null => {
    if (liveState) return liveState;
    if (contextState) return contextState;
    if (!preview?.metadata) return null;
    return buildLiveStateFromMetadata(urn, preview.title, preview.metadata);
  }, [liveState, contextState, preview, urn]);

  const isTaskDone = isTaskDoneStatus(resolvedLiveState?.taskStatus);
  const isLive = isLiveContent(resolvedLiveState?.updatedAt);
  // The live title wins over the markdown label so renames land without a reload.
  const displayLabel = resolvedLiveState?.title || label;

  const [userToggled, setUserToggled] = useState<boolean | null>(() => readToggle(urn));
  const persistToggle = (value: boolean) => {
    setUserToggled(value);
    writeToggle(urn, value);
  };
  const wantsExpanded = canExpand && (userToggled ?? defaultExpanded);
  const isExpanded = wantsExpanded && !!resolvedLiveState;

  const availability = resolvedLiveState?.availability;

  const [showPreview, setShowPreview] = useState(false);
  const [previewPosition, setPreviewPosition] = useState<{ x: number; y: number; top?: number }>({
    x: 0,
    y: 0,
  });
  const hoverTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const chipRef = useRef<HTMLSpanElement>(null);
  useTimeoutCleanup(hoverTimeoutRef, closeTimeoutRef);

  const cancelClose = () => {
    if (closeTimeoutRef.current) {
      clearTimeout(closeTimeoutRef.current);
      closeTimeoutRef.current = null;
    }
  };

  const scheduleClose = () => {
    cancelClose();
    closeTimeoutRef.current = setTimeout(() => {
      setShowPreview(false);
    }, CLOSE_DELAY);
  };

  const handleMouseEnter = () => {
    cancelClose();
    if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current);

    hoverTimeoutRef.current = setTimeout(() => {
      if (chipRef.current) {
        const rect = chipRef.current.getBoundingClientRect();
        setPreviewPosition({ x: rect.left, y: rect.bottom, top: rect.top });
        // USER hovers render the person card from the people store; a preview resolve would be wasted.
        if (urnType !== UrnType.USER) fetchPreview(urn);
        setShowPreview(true);
      }
    }, HOVER_DELAY);
  };

  const handleMouseLeave = () => {
    if (hoverTimeoutRef.current) {
      clearTimeout(hoverTimeoutRef.current);
      hoverTimeoutRef.current = null;
    }
    scheduleClose();
  };

  // The expand caret must stay clickable: entering it cancels any pending or open preview.
  const suppressPreview = () => {
    if (hoverTimeoutRef.current) {
      clearTimeout(hoverTimeoutRef.current);
      hoverTimeoutRef.current = null;
    }
    cancelClose();
    setShowPreview(false);
  };

  const handleClosePreview = () => {
    cancelClose();
    setShowPreview(false);
  };

  const handleEmbed = () => {
    if (!preview || !onReplaceWithMedia || !organizationId) return;
    const mimeType = preview.metadata?.mime_type;
    if (!mimeType || !isValidUrn || !urnId) return;

    let mediaType: "image" | "video" | "audio";
    let url: string;

    if (mimeType.startsWith("image/")) {
      mediaType = "image";
      url = buildFileUrl(organizationId, urnId);
    } else if (mimeType.startsWith("video/")) {
      mediaType = "video";
      url = buildMediaUrl(organizationId, urnId);
    } else if (mimeType.startsWith("audio/")) {
      mediaType = "audio";
      url = buildMediaUrl(organizationId, urnId);
    } else {
      return;
    }

    setShowPreview(false);
    onReplaceWithMedia(mediaType, url, label);
  };

  const showLiveIndicator = hasLiveIndicator(urnType, resolvedLiveState);

  if (availability === MentionAvailability.Deleted) {
    return wantsExpanded ? (
      <MentionTombstoneCard typeLabel={typeLabel} />
    ) : (
      <MentionTombstoneChip typeLabel={typeLabel} />
    );
  }

  if (availability === MentionAvailability.Restricted && resolvedLiveState) {
    return (
      <MentionRestricted
        urn={urn}
        label={label}
        typeLabel={typeLabel}
        style={style}
        expanded={wantsExpanded}
        liveState={resolvedLiveState}
      />
    );
  }

  if (availability === MentionAvailability.Unavailable) {
    return (
      <MentionUnavailable
        urn={urn}
        label={label}
        typeLabel={typeLabel}
        organizationId={organizationId}
        expanded={wantsExpanded}
      />
    );
  }

  const previewPortal =
    showPreview &&
    createPortal(
      <MentionPreview
        preview={preview}
        isLoading={isLoading}
        error={error}
        urn={urn}
        position={previewPosition}
        onClose={handleClosePreview}
        onEmbed={onReplaceWithMedia ? handleEmbed : undefined}
        onMouseEnter={cancelClose}
        onMouseLeave={scheduleClose}
        liveState={resolvedLiveState}
      />,
      document.body,
    );

  if (isPeopleToken) {
    return (
      <>
        <span
          ref={chipRef}
          role="link"
          tabIndex={0}
          aria-label={`${typeLabel}: ${displayLabel}`}
          className={peopleTokenClasses(isSelfMention, selected)}
          onClick={(e) => onClick?.(e)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") onClick?.();
          }}
          onMouseEnter={handleMouseEnter}
          onMouseLeave={handleMouseLeave}
          title={`Open ${typeLabel}: ${displayLabel} (Cmd/Ctrl+Click for new tab)`}
        >
          @{displayLabel}
        </span>
        {previewPortal}
      </>
    );
  }

  if (isExpanded && resolvedLiveState) {
    return (
      <MentionExpandedCard
        urn={urn}
        label={label}
        liveState={resolvedLiveState}
        description={resolvedLiveState.description ?? preview?.description}
        onClick={onClick}
        onCollapse={() => persistToggle(false)}
        onEmbed={onReplaceWithMedia ? handleEmbed : undefined}
      />
    );
  }

  if (wantsExpanded && !resolvedLiveState) {
    return <MentionExpandedCardSkeleton label={label} />;
  }

  return (
    <>
      <span
        ref={chipRef}
        role="link"
        tabIndex={0}
        aria-label={`${typeLabel}: ${displayLabel}${resolvedLiveState?.taskStatus ? `, status: ${resolvedLiveState.taskStatus}` : ""}`}
        className={cn(
          "mention-chip group/chip inline-flex items-center align-middle",
          "gap-1.5 px-2 py-1 mx-0.5 my-0.5",
          "rounded-md",
          style.badgeBg,
          "border",
          style.border,
          style.borderHover,
          isLive && "mention-chip-live",
          "cursor-pointer select-none",
          "transition-colors duration-200",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background",
          selected && "ring-2 ring-primary ring-offset-1 ring-offset-background",
        )}
        onClick={(e) => onClick?.(e)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") onClick?.();
        }}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        title={`Open ${typeLabel}: ${displayLabel} (Cmd/Ctrl+Click for new tab)`}
      >
        <span
          className={cn("grid place-items-center shrink-0 w-5 h-5 rounded", style.iconBoxAccent)}
        >
          <TypeIcon size={11} weight="duotone" />
        </span>

        {urnType === UrnType.TASK && resolvedLiveState?.taskPriorityColor && (
          <span
            className="w-2 h-2 rounded-full shrink-0"
            style={{ backgroundColor: resolvedLiveState.taskPriorityColor }}
            title={resolvedLiveState.taskPriorityLabel || "Priority"}
          />
        )}

        <span className="inline-flex items-baseline gap-1.5 min-w-0">
          {urnType === UrnType.TASK &&
            resolvedLiveState?.taskProjectSlug &&
            resolvedLiveState.taskNumber && (
              <span className="text-[11px] font-mono text-muted-foreground shrink-0">
                {resolvedLiveState.taskProjectSlug}-{resolvedLiveState.taskNumber}
              </span>
            )}
          <span
            className={cn(
              "text-sm font-medium text-foreground leading-tight",
              "truncate",
              "transition-all duration-300",
              isTaskDone && "line-through text-muted-foreground",
            )}
          >
            {displayLabel}
          </span>
        </span>

        {urnType === UrnType.FILE && resolvedLiveState?.fileMimeType && (
          <span className="text-[9px] font-semibold uppercase text-muted-foreground bg-muted rounded px-1 py-px shrink-0">
            {resolvedLiveState.fileMimeType.split("/")[1]?.toUpperCase().slice(0, 4) || "FILE"}
          </span>
        )}

        {urnType === UrnType.PROJECT && (resolvedLiveState?.projectTotalTasks ?? 0) > 0 && (
          <span className="text-[10px] font-medium text-muted-foreground tabular-nums shrink-0">
            {Math.round(
              ((resolvedLiveState?.projectCompletedTasks ?? 0) /
                resolvedLiveState!.projectTotalTasks!) *
                100,
            )}
            %
          </span>
        )}

        {urnType === UrnType.FOLDER && resolvedLiveState?.folderFileCount != null && (
          <span className="text-[10px] font-medium text-muted-foreground tabular-nums shrink-0">
            {resolvedLiveState.folderFileCount}
          </span>
        )}

        {showLiveIndicator && resolvedLiveState && (
          <span className="inline-flex items-center shrink-0 ml-0.5">
            <LiveIndicator urnType={urnType} liveState={resolvedLiveState} />
          </span>
        )}

        {!isExpanded && canExpand && resolvedLiveState && (
          <button
            onMouseDown={(e) => {
              e.preventDefault();
              e.stopPropagation();
              persistToggle(true);
            }}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
            }}
            onMouseEnter={suppressPreview}
            className="inline-flex items-center shrink-0 p-0.5 -mr-1 rounded hover:bg-foreground/10 text-muted-foreground transition-colors"
            title="Expand card"
          >
            <CaretDown size={10} weight="bold" />
          </button>
        )}
      </span>

      {previewPortal}
    </>
  );
}

function MentionChipCompactInner({
  urn,
  label,
  selected = false,
  onClick,
  liveState,
}: MentionChipCompactProps) {
  const { type: urnType, id: urnId } = parseUrn(urn);
  const style = getTypeStyle(urnType);
  const typeLabel = getUrnTypeLabel(urn);
  const TypeIcon = style.icon;
  const organizationId = useAppSelector((state) => state.auth.currentOrganizationId);
  const currentUserId = useAppSelector((state) => state.auth.user?.id);
  const isPeopleToken = isPeopleTokenType(urnType);
  const isSelfMention = urnType === UrnType.USER && !!urnId && urnId === currentUserId;

  const contextState = useMentionState(urn);
  const resolvedLiveState = liveState ?? contextState;
  const isTaskDone = isTaskDoneStatus(resolvedLiveState?.taskStatus);
  const availability = resolvedLiveState?.availability;
  const displayLabel = resolvedLiveState?.title || label;

  const [showPreview, setShowPreview] = useState(false);
  const [previewPosition, setPreviewPosition] = useState<{ x: number; y: number; top?: number }>({
    x: 0,
    y: 0,
  });
  const hoverTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const chipRef = useRef<HTMLSpanElement>(null);
  const { preview, isLoading, error, fetchPreview } = useUrnPreview();
  useTimeoutCleanup(hoverTimeoutRef, closeTimeoutRef);

  const cancelClose = () => {
    if (closeTimeoutRef.current) {
      clearTimeout(closeTimeoutRef.current);
      closeTimeoutRef.current = null;
    }
  };

  const scheduleClose = () => {
    cancelClose();
    closeTimeoutRef.current = setTimeout(() => setShowPreview(false), CLOSE_DELAY);
  };

  const handleMouseEnter = () => {
    cancelClose();
    if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current);
    hoverTimeoutRef.current = setTimeout(() => {
      if (chipRef.current) {
        const rect = chipRef.current.getBoundingClientRect();
        setPreviewPosition({ x: rect.left, y: rect.bottom, top: rect.top });
        if (urnType !== UrnType.USER) fetchPreview(urn);
        setShowPreview(true);
      }
    }, HOVER_DELAY);
  };

  const handleMouseLeave = () => {
    if (hoverTimeoutRef.current) {
      clearTimeout(hoverTimeoutRef.current);
      hoverTimeoutRef.current = null;
    }
    scheduleClose();
  };

  const showLiveIndicator = hasLiveIndicator(urnType, resolvedLiveState, true);

  if (availability === MentionAvailability.Deleted) {
    return <MentionTombstoneChip typeLabel={typeLabel} compact />;
  }

  if (availability === MentionAvailability.Restricted && resolvedLiveState) {
    return (
      <MentionRestricted
        urn={urn}
        label={label}
        typeLabel={typeLabel}
        style={style}
        compact
        liveState={resolvedLiveState}
      />
    );
  }

  if (availability === MentionAvailability.Unavailable) {
    return (
      <MentionUnavailable
        urn={urn}
        label={label}
        typeLabel={typeLabel}
        organizationId={organizationId}
        compact
      />
    );
  }

  const previewPortal =
    showPreview &&
    createPortal(
      <MentionPreview
        preview={preview}
        isLoading={isLoading}
        error={error}
        urn={urn}
        position={previewPosition}
        onClose={() => {
          cancelClose();
          setShowPreview(false);
        }}
        onMouseEnter={cancelClose}
        onMouseLeave={scheduleClose}
        liveState={resolvedLiveState}
      />,
      document.body,
    );

  if (isPeopleToken) {
    return (
      <>
        <span
          ref={chipRef}
          role="link"
          tabIndex={0}
          aria-label={`${typeLabel}: ${displayLabel}`}
          className={cn(peopleTokenClasses(isSelfMention, selected), "text-xs")}
          onClick={(e) => onClick?.(e)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") onClick?.();
          }}
          onMouseEnter={handleMouseEnter}
          onMouseLeave={handleMouseLeave}
          title={`Open ${typeLabel}: ${displayLabel}`}
        >
          @{displayLabel}
        </span>
        {previewPortal}
      </>
    );
  }

  return (
    <>
      <span
        ref={chipRef}
        role="link"
        tabIndex={0}
        aria-label={`${typeLabel}: ${displayLabel}`}
        className={cn(
          "mention-chip-compact group/chip inline-flex items-center align-middle",
          "gap-1 px-1.5 py-0.5 mx-0.5",
          "rounded-md",
          style.badgeBg,
          "border",
          style.border,
          style.borderHover,
          "cursor-pointer select-none",
          "transition-colors duration-150",
          "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
          selected && "ring-1 ring-primary",
        )}
        onClick={(e) => onClick?.(e)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") onClick?.();
        }}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        title={`Open ${typeLabel}: ${displayLabel}`}
      >
        <span
          className={cn(
            "grid place-items-center shrink-0 w-3.5 h-3.5 rounded-sm",
            style.iconBoxAccent,
          )}
        >
          <TypeIcon size={8} weight="duotone" />
        </span>

        <span
          className={cn(
            "text-xs font-medium text-foreground truncate max-w-[100px]",
            isTaskDone && "line-through text-muted-foreground",
          )}
        >
          {displayLabel}
        </span>

        {showLiveIndicator && resolvedLiveState && (
          <LiveIndicator urnType={urnType} liveState={resolvedLiveState} compact />
        )}
      </span>

      {previewPortal}
    </>
  );
}

// Default shallow comparison only — context-driven re-renders need to flow through; a custom equality would shadow that contract.
export const MentionChip = memo(MentionChipInner);
export const MentionChipCompact = memo(MentionChipCompactInner);
