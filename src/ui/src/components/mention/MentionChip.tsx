/* eslint-disable react-hooks/preserve-manual-memoization */
import { memo, useState, useRef, useCallback, useMemo, useEffect, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { CaretDown, Robot, Trash } from '@phosphor-icons/react';
import { parseUrn, getUrnTypeLabel, UrnType } from '@/shared/utils/urn';
import { buildFileUrl, buildMediaStreamUrl, buildAgentAvatarUrl } from '@/shared/utils/fileUrls';
import { MentionPreview } from '@/components/mention/MentionPreview';
import { MentionExpandedCard } from '@/components/mention/MentionExpandedCard';
import { buildLiveStateFromMetadata } from '@/components/mention/buildLiveState';
import { hasExpandedCard } from '@/components/mention/mentionConstants';
import { useUrnPreview } from '@/components/editor/plugins/mention/useUrnPreview';
import { getContentTypeConfig } from '@/config/theme/contentTypes';
import { useAppSelector } from '@/app/hooks';
import { usePresence } from '@/features/presence/hooks/usePresence';
import { useAvatarUrl } from '@/shared/hooks/useAvatarUrl';
import { PresenceIndicator } from '@/components/subject/PresenceIndicator';
import { LiveIndicator } from '@/components/mention/LiveIndicators';
import { isTaskDoneStatus } from '@/components/mention/types';
import { getInitials } from '@/components/subject/utils';
import { useMentionState, useMentionDisplay } from '@/components/mention/useMentionState';
import { cn } from '@/shared/utils/cn';
import type { Icon } from '@phosphor-icons/react';
import type { MentionChipProps, MentionChipBasicProps, MentionChipCompactProps, MentionLiveState } from '@/components/mention/types';

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

/** localStorage key prefix for per-URN expand/collapse preference. */
const TOGGLE_STORAGE_PREFIX = 'mention-toggle:';

function readToggle(urn: string): boolean | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(TOGGLE_STORAGE_PREFIX + urn);
    if (raw === 'true') return true;
    if (raw === 'false') return false;
    return null;
  } catch {
    return null;
  }
}

function writeToggle(urn: string, value: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(TOGGLE_STORAGE_PREFIX + urn, String(value));
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
        'mention-expanded-card not-prose relative block',
        'w-80 my-2 px-4 py-3',
        'bg-card/95 backdrop-blur-xl',
        'rounded-xl border border-border/50 shadow-sm',
        'overflow-hidden',
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
        'mention-chip-tombstone inline-flex items-center align-middle',
        'rounded-md border border-dashed border-muted-foreground/40',
        'bg-muted/40 text-muted-foreground',
        'select-none cursor-not-allowed',
        compact
          ? 'gap-1 px-1.5 py-0.5 mx-0.5 text-xs'
          : 'gap-1.5 px-2 py-1 mx-0.5 my-0.5',
      )}
    >
      <span className={cn(
        'grid place-items-center shrink-0 rounded',
        compact ? 'w-3.5 h-3.5' : 'w-5 h-5',
        'bg-muted-foreground/10 text-muted-foreground/70',
      )}>
        <Trash size={compact ? 8 : 11} weight="duotone" />
      </span>
      <span className={cn(
        'font-medium italic',
        compact ? 'text-xs' : 'text-sm',
      )}>
        {labelText}
      </span>
    </span>
  );
}

function MentionTombstoneCard({
  typeLabel,
}: {
  typeLabel: string;
}) {
  const heading = `Deleted ${typeLabel.toLowerCase()}`;
  return (
    <span
      role="img"
      aria-label={heading}
      className={cn(
        'mention-expanded-card not-prose relative block',
        'w-80 my-2 px-4 py-3',
        'bg-muted/40 backdrop-blur-xl text-muted-foreground',
        'rounded-xl border border-dashed border-muted-foreground/40',
        'cursor-not-allowed select-none',
      )}
      title={heading}
    >
      <span className="flex items-start gap-3">
        <span className="grid place-items-center shrink-0 w-10 h-10 rounded-lg bg-muted-foreground/10 text-muted-foreground/70">
          <Trash size={18} weight="duotone" />
        </span>
        <span className="block flex-1 min-w-0 pt-0.5">
          <span className="block font-semibold text-sm italic text-foreground/70">
            {heading}
          </span>
          <span className="block mt-1.5 text-xs text-muted-foreground leading-relaxed">
            This reference no longer points to a live item. The original
            content was removed or you no longer have access to it.
          </span>
        </span>
      </span>
    </span>
  );
}

/** Null `src` skips the `<img>` entirely so we don't fire a 404 for subjects with no avatar. */
function ChipAvatar({
  src,
  size,
  fallback,
}: {
  src: string | null;
  size: number;
  fallback: React.ReactNode;
}) {
  const [failed, setFailed] = useState(false);
  if (!src || failed) return <>{fallback}</>;
  return (
    <img
      src={src}
      alt=""
      className="rounded-full object-cover"
      style={{ width: size, height: size }}
      onError={() => setFailed(true)}
    />
  );
}

interface TypeStyle {
  icon: Icon;
  gradient: string;
  iconBg: string;
  iconBoxAccent: string;
  border: string;
  shadow: string;
  glow: string;
  badgeBg: string;
  accentText: string;
}

function getTypeStyle(type: UrnType): TypeStyle {
  const config = getContentTypeConfig(type);
  const theme = config.theme;
  return {
    icon: config.icon,
    gradient: theme.gradient,
    iconBg: theme.iconBg,
    iconBoxAccent: theme.iconBoxAccent,
    border: theme.border,
    shadow: theme.shadow,
    glow: theme.glow,
    badgeBg: theme.badgeBg,
    accentText: theme.accentText,
  };
}

function isLiveContent(updatedAt?: string): boolean {
  if (!updatedAt) return false;
  return Date.now() - new Date(updatedAt).getTime() < 60_000;
}

function MentionChipInner({
  urn,
  label,
  selected = false,
  onClick,
  onReplaceWithMedia,
  liveState,
}: MentionChipProps) {
  const parsed = parseUrn(urn);
  const style = getTypeStyle(parsed.type);
  const typeLabel = getUrnTypeLabel(urn);
  const TypeIcon = style.icon;
  const organizationId = useAppSelector((state) => state.auth.currentOrganizationId);
  const isUser = parsed.type === UrnType.USER && !!parsed.id;
  const isAgent = parsed.type === UrnType.AGENT && !!parsed.id;
  const presenceStatus = usePresence(isUser ? parsed.id! : '');
  const avatarSrc = useAvatarUrl(isUser ? parsed.id! : '', 'sm');
  const agent = useAppSelector((state) =>
    isAgent ? state.agents.agents[parsed.id!] ?? null : null,
  );

  const contextState = useMentionState(urn);

  const { preview, isLoading, error, fetchPreview } = useUrnPreview();

  const mentionDisplay = useMentionDisplay();
  const defaultExpanded = mentionDisplay !== 'compact';

  const canExpand = hasExpandedCard(parsed.type);

  const resolvedLiveState = useMemo((): MentionLiveState | null => {
    if (liveState) return liveState;
    if (contextState) return contextState;
    if (!preview?.metadata) return null;
    return buildLiveStateFromMetadata(urn, preview.title, preview.metadata);
  }, [liveState, contextState, preview, urn]);

  const isTaskDone = isTaskDoneStatus(resolvedLiveState?.taskStatus);
  const isLive = isLiveContent(resolvedLiveState?.updatedAt);

  const [userToggled, setUserToggled] = useState<boolean | null>(() => readToggle(urn));
  const persistToggle = useCallback((value: boolean) => {
    setUserToggled(value);
    writeToggle(urn, value);
  }, [urn]);
  const wantsExpanded = canExpand && (userToggled ?? defaultExpanded);
  const isExpanded = wantsExpanded && !!resolvedLiveState;

  const isDeleted = resolvedLiveState?.status === 'deleted';

  const [showPreview, setShowPreview] = useState(false);
  const [previewPosition, setPreviewPosition] = useState({ x: 0, y: 0 });
  const hoverTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const chipRef = useRef<HTMLSpanElement>(null);
  useTimeoutCleanup(hoverTimeoutRef, closeTimeoutRef);

  const cancelClose = useCallback(() => {
    if (closeTimeoutRef.current) {
      clearTimeout(closeTimeoutRef.current);
      closeTimeoutRef.current = null;
    }
  }, []);

  const scheduleClose = useCallback(() => {
    cancelClose();
    closeTimeoutRef.current = setTimeout(() => {
      setShowPreview(false);
    }, CLOSE_DELAY);
  }, [cancelClose]);

  const handleMouseEnter = useCallback(() => {
    cancelClose();
    if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current);

    hoverTimeoutRef.current = setTimeout(() => {
      if (chipRef.current) {
        const rect = chipRef.current.getBoundingClientRect();
        setPreviewPosition({ x: rect.left, y: rect.bottom });
        fetchPreview(urn);
        setShowPreview(true);
      }
    }, HOVER_DELAY);
  }, [urn, fetchPreview, cancelClose]);

  const handleMouseLeave = useCallback(() => {
    if (hoverTimeoutRef.current) {
      clearTimeout(hoverTimeoutRef.current);
      hoverTimeoutRef.current = null;
    }
    scheduleClose();
  }, [scheduleClose]);

  const handleClosePreview = useCallback(() => {
    cancelClose();
    setShowPreview(false);
  }, [cancelClose]);

  const handleEmbed = useCallback(() => {
    if (!preview || !onReplaceWithMedia || !organizationId) return;
    const mimeType = preview.metadata?.mime_type;
    if (!mimeType || !parsed.isValid || !parsed.id) return;

    let mediaType: 'image' | 'video' | 'audio';
    let url: string;

    if (mimeType.startsWith('image/')) {
      mediaType = 'image';
      url = buildFileUrl(organizationId, parsed.id);
    } else if (mimeType.startsWith('video/')) {
      mediaType = 'video';
      url = buildMediaStreamUrl(organizationId, parsed.id);
    } else if (mimeType.startsWith('audio/')) {
      mediaType = 'audio';
      url = buildMediaStreamUrl(organizationId, parsed.id);
    } else {
      return;
    }

    setShowPreview(false);
    onReplaceWithMedia(mediaType, url, label);
  }, [preview, onReplaceWithMedia, organizationId, parsed.isValid, parsed.id, label]);

  const hasLiveIndicator = useMemo(() => {
    if (!resolvedLiveState) return false;
    switch (parsed.type) {
      case UrnType.TASK: return !!resolvedLiveState.taskStatus;
      case UrnType.CALENDAR_EVENT: return !!resolvedLiveState.eventStartTime;
      case UrnType.NOTE: return !!resolvedLiveState.noteIsBeingEdited;
      case UrnType.FILE: return !!resolvedLiveState.fileProcessingStatus;
      case UrnType.PROJECT: return (resolvedLiveState.projectTotalTasks ?? 0) > 0;
      default: return false;
    }
  }, [parsed.type, resolvedLiveState]);

  if (isDeleted) {
    return wantsExpanded
      ? <MentionTombstoneCard typeLabel={typeLabel} />
      : <MentionTombstoneChip typeLabel={typeLabel} />;
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
        aria-label={`${typeLabel}: ${label}${resolvedLiveState?.taskStatus ? `, status: ${resolvedLiveState.taskStatus}` : ''}`}
        className={cn(
          'mention-chip group/chip inline-flex items-center align-middle',
          'gap-1.5 px-2 py-1 mx-0.5 my-0.5',
          'rounded-md',
          'bg-gradient-to-r', style.gradient,
          'backdrop-blur-sm',
          'border', style.border,
          isLive && 'mention-chip-live',
          style.glow,
          'cursor-pointer select-none',
          'transition-all duration-200 ease-out',
          'hover:shadow-md hover:scale-[1.01]',
          'active:scale-[0.98]',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background',
          selected && 'ring-2 ring-primary ring-offset-1 ring-offset-background',
        )}
        onClick={(e) => onClick?.(e)}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onClick?.(); }}
        onMouseEnter={canExpand ? undefined : handleMouseEnter}
        onMouseLeave={canExpand ? undefined : handleMouseLeave}
        title={`Open ${typeLabel}: ${label} (Cmd/Ctrl+Click for new tab)`}
      >
        {isUser ? (
          <span className="relative flex items-center justify-center shrink-0 w-5 h-5 rounded-full overflow-visible">
            <ChipAvatar
              src={avatarSrc}
              size={20}
              fallback={
                <span className={cn('grid place-items-center w-5 h-5 rounded-full text-[8px] font-semibold', style.iconBoxAccent)}>
                  {getInitials(label)}
                </span>
              }
            />
            <PresenceIndicator status={presenceStatus} size="sm" />
          </span>
        ) : isAgent ? (
          <span className="relative flex items-center justify-center shrink-0 w-5 h-5 rounded-full overflow-visible">
            <span className="flex items-center justify-center w-5 h-5 rounded-full overflow-hidden">
              <ChipAvatar
                src={agent?.avatarKey ? buildAgentAvatarUrl(parsed.id!, 'sm') : null}
                size={20}
                fallback={
                  <span className={cn(
                    'grid place-items-center w-5 h-5 rounded-full text-[10px]',
                    agent?.avatarEmoji ? 'bg-muted' : style.iconBoxAccent,
                  )}>
                    {agent?.avatarEmoji ?? <TypeIcon size={11} weight="duotone" />}
                  </span>
                }
              />
            </span>
            <span
              className="absolute -bottom-0.5 -right-0.5 flex items-center justify-center w-2.5 h-2.5 rounded-full ring-2 ring-background shrink-0 bg-primary text-primary-foreground"
              aria-label="Agent"
              title="Agent"
            >
              <Robot size={7} weight="fill" />
            </span>
          </span>
        ) : (
          <span className={cn(
            'grid place-items-center shrink-0 w-5 h-5 rounded',
            style.iconBoxAccent,
          )}>
            <TypeIcon size={11} weight="duotone" />
          </span>
        )}

        {parsed.type === UrnType.TASK && resolvedLiveState?.taskPriorityColor && (
          <span
            className="w-2 h-2 rounded-full shrink-0"
            style={{ backgroundColor: resolvedLiveState.taskPriorityColor }}
            title={resolvedLiveState.taskPriorityLabel || 'Priority'}
          />
        )}

        <span className="inline-flex items-baseline gap-1.5 min-w-0">
          {parsed.type === UrnType.TASK && resolvedLiveState?.taskProjectSlug && resolvedLiveState.taskNumber && (
            <span className="text-[11px] font-mono text-muted-foreground shrink-0">
              {resolvedLiveState.taskProjectSlug}-{resolvedLiveState.taskNumber}
            </span>
          )}
          <span
            className={cn(
              'text-sm font-medium text-foreground leading-tight',
              'truncate',
              'transition-all duration-300',
              isTaskDone && 'line-through text-muted-foreground',
            )}
          >
            {label}
          </span>
        </span>

        {parsed.type === UrnType.FILE && resolvedLiveState?.fileMimeType && (
          <span className="text-[9px] font-semibold uppercase text-muted-foreground bg-muted rounded px-1 py-px shrink-0">
            {resolvedLiveState.fileMimeType.split('/')[1]?.toUpperCase().slice(0, 4) || 'FILE'}
          </span>
        )}

        {parsed.type === UrnType.PROJECT && (resolvedLiveState?.projectTotalTasks ?? 0) > 0 && (
          <span className="text-[10px] font-medium text-muted-foreground tabular-nums shrink-0">
            {Math.round(((resolvedLiveState?.projectCompletedTasks ?? 0) / resolvedLiveState!.projectTotalTasks!) * 100)}%
          </span>
        )}

        {hasLiveIndicator && resolvedLiveState && (
          <span className="inline-flex items-center shrink-0 ml-0.5">
            <LiveIndicator urnType={parsed.type} liveState={resolvedLiveState} />
          </span>
        )}

        {!isExpanded && canExpand && resolvedLiveState && (
          <button
            onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); persistToggle(true); }}
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}
            className="inline-flex items-center shrink-0 p-0.5 -mr-1 rounded hover:bg-foreground/10 text-muted-foreground transition-colors"
            title="Expand card"
          >
            <CaretDown size={10} weight="bold" />
          </button>
        )}
      </span>

      {showPreview && !canExpand && createPortal(
        <MentionPreview
          preview={preview}
          isLoading={isLoading}
          error={error}
          position={previewPosition}
          onClose={handleClosePreview}
          onEmbed={onReplaceWithMedia ? handleEmbed : undefined}
          onMouseEnter={cancelClose}
          onMouseLeave={scheduleClose}
          liveState={resolvedLiveState}
        />,
        document.body,
      )}
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
  const parsed = parseUrn(urn);
  const style = getTypeStyle(parsed.type);
  const typeLabel = getUrnTypeLabel(urn);
  const TypeIcon = style.icon;
  const isUser = parsed.type === UrnType.USER && !!parsed.id;
  const isAgent = parsed.type === UrnType.AGENT && !!parsed.id;
  const presenceStatus = usePresence(isUser ? parsed.id! : '');
  const avatarSrc = useAvatarUrl(isUser ? parsed.id! : '', 'sm');
  const agent = useAppSelector((state) =>
    isAgent ? state.agents.agents[parsed.id!] ?? null : null,
  );

  const contextState = useMentionState(urn);
  const resolvedLiveState = liveState ?? contextState;
  const isTaskDone = isTaskDoneStatus(resolvedLiveState?.taskStatus);
  const isDeleted = resolvedLiveState?.status === 'deleted';

  const [showPreview, setShowPreview] = useState(false);
  const [previewPosition, setPreviewPosition] = useState({ x: 0, y: 0 });
  const hoverTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const chipRef = useRef<HTMLSpanElement>(null);
  const { preview, isLoading, error, fetchPreview } = useUrnPreview();
  useTimeoutCleanup(hoverTimeoutRef, closeTimeoutRef);

  const cancelClose = useCallback(() => {
    if (closeTimeoutRef.current) {
      clearTimeout(closeTimeoutRef.current);
      closeTimeoutRef.current = null;
    }
  }, []);

  const scheduleClose = useCallback(() => {
    cancelClose();
    closeTimeoutRef.current = setTimeout(() => setShowPreview(false), CLOSE_DELAY);
  }, [cancelClose]);

  const handleMouseEnter = useCallback(() => {
    cancelClose();
    if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current);
    hoverTimeoutRef.current = setTimeout(() => {
      if (chipRef.current) {
        const rect = chipRef.current.getBoundingClientRect();
        setPreviewPosition({ x: rect.left, y: rect.bottom });
        fetchPreview(urn);
        setShowPreview(true);
      }
    }, HOVER_DELAY);
  }, [urn, fetchPreview, cancelClose]);

  const handleMouseLeave = useCallback(() => {
    if (hoverTimeoutRef.current) {
      clearTimeout(hoverTimeoutRef.current);
      hoverTimeoutRef.current = null;
    }
    scheduleClose();
  }, [scheduleClose]);

  const hasLiveIndicator = useMemo(() => {
    if (!resolvedLiveState) return false;
    switch (parsed.type) {
      case UrnType.TASK: return !!resolvedLiveState.taskStatus;
      case UrnType.CALENDAR_EVENT: return !!resolvedLiveState.eventStartTime;
      case UrnType.NOTE: return !!resolvedLiveState.noteIsBeingEdited;
      default: return false;
    }
  }, [parsed.type, resolvedLiveState]);

  if (isDeleted) {
    return <MentionTombstoneChip typeLabel={typeLabel} compact />;
  }

  return (
    <>
      <span
        ref={chipRef}
        role="link"
        tabIndex={0}
        aria-label={`${typeLabel}: ${label}`}
        className={cn(
          'mention-chip-compact group/chip inline-flex items-center align-middle',
          'gap-1 px-1.5 py-0.5 mx-0.5',
          'rounded-md',
          'bg-gradient-to-r', style.gradient,
          'border', style.border,
          style.glow,
          'cursor-pointer select-none',
          'transition-all duration-150',
          'hover:shadow-sm',
          'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
          selected && 'ring-1 ring-primary',
        )}
        onClick={(e) => onClick?.(e)}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onClick?.(); }}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        title={`Open ${typeLabel}: ${label}`}
      >
        {isUser ? (
          <span className="relative flex items-center justify-center shrink-0 w-3.5 h-3.5 rounded-full overflow-visible">
            <ChipAvatar
              src={avatarSrc}
              size={14}
              fallback={
                <span className={cn('grid place-items-center w-3.5 h-3.5 rounded-sm', style.iconBoxAccent)}>
                  <TypeIcon size={8} weight="duotone" />
                </span>
              }
            />
            <PresenceIndicator status={presenceStatus} size="sm" className="!w-1.5 !h-1.5 !ring-1" />
          </span>
        ) : isAgent ? (
          <span className="relative flex items-center justify-center shrink-0 w-3.5 h-3.5 rounded-full overflow-visible">
            <span className="flex items-center justify-center w-3.5 h-3.5 rounded-full overflow-hidden">
              <ChipAvatar
                src={agent?.avatarKey ? buildAgentAvatarUrl(parsed.id!, 'sm') : null}
                size={14}
                fallback={
                  <span className={cn(
                    'grid place-items-center w-3.5 h-3.5 rounded-full text-[8px]',
                    agent?.avatarEmoji ? 'bg-muted' : style.iconBoxAccent,
                  )}>
                    {agent?.avatarEmoji ?? <TypeIcon size={8} weight="duotone" />}
                  </span>
                }
              />
            </span>
            <span
              className="absolute -bottom-0.5 -right-0.5 flex items-center justify-center w-2 h-2 rounded-full ring-1 ring-background shrink-0 bg-primary text-primary-foreground"
              aria-label="Agent"
              title="Agent"
            >
              <Robot size={6} weight="fill" />
            </span>
          </span>
        ) : (
          <span className={cn('grid place-items-center shrink-0 w-3.5 h-3.5 rounded-sm', style.iconBoxAccent)}>
            <TypeIcon size={8} weight="duotone" />
          </span>
        )}

        <span
          className={cn(
            'text-xs font-medium text-foreground truncate max-w-[100px]',
            isTaskDone && 'line-through text-muted-foreground',
          )}
        >
          {label}
        </span>

        {hasLiveIndicator && resolvedLiveState && (
          <LiveIndicator urnType={parsed.type} liveState={resolvedLiveState} compact />
        )}
      </span>

      {showPreview && createPortal(
        <MentionPreview
          preview={preview}
          isLoading={isLoading}
          error={error}
          position={previewPosition}
          onClose={() => { cancelClose(); setShowPreview(false); }}
          onMouseEnter={cancelClose}
          onMouseLeave={scheduleClose}
          liveState={resolvedLiveState}
        />,
        document.body,
      )}
    </>
  );
}

/** ProseMirror NodeView fallback: no Redux context, so no hover/live state. */
function MentionChipBasicInner({ urn, label, selected = false }: MentionChipBasicProps) {
  const parsed = parseUrn(urn);
  const style = getTypeStyle(parsed.type);
  const typeLabel = getUrnTypeLabel(urn);
  const TypeIcon = style.icon;
  const isUser = parsed.type === UrnType.USER && !!parsed.id;
  const isAgent = parsed.type === UrnType.AGENT && !!parsed.id;

  return (
    <span
      role="link"
      className={cn(
        'mention-chip group/chip inline-flex items-center align-middle',
        'gap-1.5 px-2 py-1 mx-0.5 my-0.5',
        'rounded-md',
        'bg-gradient-to-r', style.gradient,
        'backdrop-blur-sm',
        'border', style.border,
        style.glow,
        'cursor-pointer select-none',
        'transition-all duration-200 ease-out',
        'hover:shadow-md hover:scale-[1.01]',
        'active:scale-[0.98]',
        selected && 'ring-2 ring-primary ring-offset-1 ring-offset-background',
      )}
      title={`Open ${typeLabel}: ${label} (Cmd/Ctrl+Click for new tab)`}
    >
      {isUser && parsed.id ? (
        <span className={cn('grid place-items-center shrink-0 w-5 h-5 rounded-full text-[8px] font-semibold', style.iconBoxAccent)}>
          {getInitials(label)}
        </span>
      ) : isAgent && parsed.id ? (
        <span className={cn('grid place-items-center shrink-0 w-5 h-5 rounded-full', style.iconBoxAccent)}>
          <TypeIcon size={11} weight="duotone" />
        </span>
      ) : (
        <span className={cn(
          'grid place-items-center shrink-0 w-5 h-5 rounded',
          style.iconBoxAccent,
        )}>
          <TypeIcon size={11} weight="duotone" />
        </span>
      )}

      <span className="text-sm font-medium text-foreground truncate max-w-[200px] leading-tight">
        {label}
      </span>
    </span>
  );
}

// Default shallow comparison only — context-driven re-renders need to flow through; a custom equality would shadow that contract.
export const MentionChip = memo(MentionChipInner);
export const MentionChipCompact = memo(MentionChipCompactInner);
export const MentionChipBasic = memo(MentionChipBasicInner);
