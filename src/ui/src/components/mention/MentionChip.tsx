/* eslint-disable react-hooks/preserve-manual-memoization */
/**
 * Live Mention Chip
 *
 * A living inline artifact that shows the real-time state of referenced content.
 * Each chip is a tiny dashboard: the icon encodes the type, the label identifies
 * the content, and type-specific indicators telegraph its current state.
 *
 * Three variants:
 * - MentionChip: Full-featured with hover preview and live indicators
 * - MentionChipCompact: Dense text contexts with hover preview
 * - MentionChipBasic: ProseMirror NodeView fallback (no Redux)
 *
 * Design language: "Signal" - information-dense, calm, orchestrated motion.
 * The border subtly breathes with the type color when content is live.
 */

import { memo, useState, useRef, useCallback, useMemo, useEffect, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { CaretDown, Robot } from '@phosphor-icons/react';
import { parseUrn, getUrnTypeLabel, UrnType } from '@/shared/utils/urn';
import { buildFileUrl, buildMediaStreamUrl, buildAvatarUrl, buildAgentAvatarUrl } from '@/shared/utils/fileUrls';
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

// Delays (ms)
const HOVER_DELAY = 200;
const CLOSE_DELAY = 350;

/** Clear pending hover/close timeouts on unmount to prevent setState on unmounted components */
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

/**
 * Avatar image with fallback to type icon
 */
function ChipAvatar({
  src,
  size,
  fallback,
}: {
  src: string;
  size: number;
  fallback: React.ReactNode;
}) {
  const [failed, setFailed] = useState(false);
  if (failed) return <>{fallback}</>;
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

/**
 * Type-aware icon badge
 */
interface TypeStyle {
  icon: Icon;
  gradient: string;
  iconBg: string;
  border: string;
  shadow: string;
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
    border: theme.border,
    shadow: theme.shadow,
    badgeBg: theme.badgeBg,
    accentText: theme.accentText,
  };
}

/**
 * Detect if content was very recently updated (< 60s) for the "live edge" effect
 */
function isLiveContent(updatedAt?: string): boolean {
  if (!updatedAt) return false;
  return Date.now() - new Date(updatedAt).getTime() < 60_000;
}

/**
 * Full MentionChip - inline in notes/chat with hover preview and live state.
 *
 * Visual structure:
 * [icon-badge] Label [live-indicator]
 *   ^gradient bg    ^type-specific status
 *
 * On hover: rich preview card with content summary and quick actions.
 * On state change: border briefly glows, indicators animate transitions.
 */
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

  // Auto-resolve live state from provider when no explicit prop
  const contextState = useMentionState(urn);

  const { preview, isLoading, error, fetchPreview } = useUrnPreview();

  // User preference for mention display mode (provider-driven, single subscription per page)
  const mentionDisplay = useMentionDisplay();
  const defaultExpanded = mentionDisplay !== 'compact';

  const canExpand = hasExpandedCard(parsed.type);

  // Build liveState from provider state, explicit prop, or preview metadata fallback
  const resolvedLiveState = useMemo((): MentionLiveState | null => {
    if (liveState) return liveState;
    if (contextState) return contextState;
    if (!preview?.metadata) return null;
    return buildLiveStateFromMetadata(urn, preview.title, preview.metadata);
  }, [liveState, contextState, preview, urn]);

  const isTaskDone = isTaskDoneStatus(resolvedLiveState?.taskStatus);
  const isLive = isLiveContent(resolvedLiveState?.updatedAt);

  const [userToggled, setUserToggled] = useState<boolean | null>(null);
  const isExpanded = canExpand && !!resolvedLiveState && (userToggled ?? defaultExpanded);

  // Hover preview state
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

  // Determine if we have any live indicator to show
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

  // Expanded card mode
  if (isExpanded && resolvedLiveState) {
    return (
      <MentionExpandedCard
        urn={urn}
        label={label}
        liveState={resolvedLiveState}
        description={preview?.description}
        onClick={onClick}
        onCollapse={() => setUserToggled(false)}
        onEmbed={onReplaceWithMedia ? handleEmbed : undefined}
      />
    );
  }

  return (
    <>
      <span
        ref={chipRef}
        role="link"
        tabIndex={0}
        aria-label={`${typeLabel}: ${label}${resolvedLiveState?.taskStatus ? `, status: ${resolvedLiveState.taskStatus}` : ''}`}
        className={cn(
          // Layout
          'mention-chip group/chip inline-flex items-center align-middle',
          'gap-1.5 px-2 py-1 mx-0.5 my-0.5',
          'rounded-md',
          // Surface - subtle gradient wash
          'bg-gradient-to-r', style.gradient,
          'backdrop-blur-sm',
          // Border - with live breathing glow
          'border', style.border,
          isLive && 'mention-chip-live',
          // Interaction
          'cursor-pointer select-none',
          'transition-all duration-200 ease-out',
          'hover:shadow-md hover:scale-[1.01]',
          'active:scale-[0.98]',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background',
          // Selection
          selected && 'ring-2 ring-primary ring-offset-1 ring-offset-background',
        )}
        onClick={(e) => onClick?.(e)}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onClick?.(); }}
        onMouseEnter={canExpand ? undefined : handleMouseEnter}
        onMouseLeave={canExpand ? undefined : handleMouseLeave}
        title={`Open ${typeLabel}: ${label} (Cmd/Ctrl+Click for new tab)`}
      >
        {/* Icon badge / user avatar / agent avatar */}
        {isUser ? (
          <span className="relative flex items-center justify-center shrink-0 w-5 h-5 rounded-full overflow-visible">
            <ChipAvatar
              src={avatarSrc}
              size={20}
              fallback={
                <span className={cn('flex items-center justify-center w-5 h-5 rounded-full text-[8px] font-semibold text-white', style.iconBg)}>
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
                src={buildAgentAvatarUrl(parsed.id!, 'sm')}
                size={20}
                fallback={
                  <span className={cn(
                    'flex items-center justify-center w-5 h-5 rounded-full text-[10px]',
                    agent?.avatarEmoji ? 'bg-muted' : cn('text-white', style.iconBg),
                  )}>
                    {agent?.avatarEmoji ?? <TypeIcon size={11} weight="duotone" className="text-white" />}
                  </span>
                }
              />
            </span>
            <span
              className={cn(
                'absolute -bottom-0.5 -right-0.5 flex items-center justify-center w-2.5 h-2.5 rounded-full ring-2 ring-background shrink-0',
                style.iconBg,
              )}
              aria-label="Agent"
              title="Agent"
            >
              <Robot size={7} weight="fill" className="text-white" />
            </span>
          </span>
        ) : (
          <span className={cn(
            'flex items-center justify-center shrink-0 w-5 h-5 rounded',
            style.iconBg,
            'shadow-sm',
            'transition-transform duration-200 group-hover/chip:scale-110',
          )}>
            <TypeIcon size={11} weight="duotone" className="text-white" />
          </span>
        )}

        {/* Task priority dot */}
        {parsed.type === UrnType.TASK && resolvedLiveState?.taskPriorityColor && (
          <span
            className="w-2 h-2 rounded-full shrink-0"
            style={{ backgroundColor: resolvedLiveState.taskPriorityColor }}
            title={resolvedLiveState.taskPriorityLabel || 'Priority'}
          />
        )}

        {/* Label with optional task ID prefix */}
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

        {/* File extension badge */}
        {parsed.type === UrnType.FILE && resolvedLiveState?.fileMimeType && (
          <span className="text-[9px] font-semibold uppercase text-muted-foreground bg-muted rounded px-1 py-px shrink-0">
            {resolvedLiveState.fileMimeType.split('/')[1]?.toUpperCase().slice(0, 4) || 'FILE'}
          </span>
        )}

        {/* Project progress percentage */}
        {parsed.type === UrnType.PROJECT && (resolvedLiveState?.projectTotalTasks ?? 0) > 0 && (
          <span className="text-[10px] font-medium text-muted-foreground tabular-nums shrink-0">
            {Math.round(((resolvedLiveState?.projectCompletedTasks ?? 0) / resolvedLiveState!.projectTotalTasks!) * 100)}%
          </span>
        )}

        {/* Live status indicator */}
        {hasLiveIndicator && resolvedLiveState && (
          <span className="inline-flex items-center shrink-0 ml-0.5">
            <LiveIndicator urnType={parsed.type} liveState={resolvedLiveState} />
          </span>
        )}

        {/* Expand button */}
        {!isExpanded && canExpand && resolvedLiveState && (
          <button
            onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); setUserToggled(true); }}
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}
            className="inline-flex items-center shrink-0 p-0.5 -mr-1 rounded hover:bg-foreground/10 text-muted-foreground transition-colors"
            title="Expand card"
          >
            <CaretDown size={10} weight="bold" />
          </button>
        )}
      </span>

      {/* Hover preview popover - disabled when expand/collapse is available */}
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

/**
 * Compact inline variant for dense text contexts (search results, comments).
 * Smaller footprint, still shows live indicators in condensed form.
 */
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

  // Auto-resolve live state from provider when no explicit prop
  const contextState = useMentionState(urn);
  const resolvedLiveState = liveState ?? contextState;
  const isTaskDone = isTaskDoneStatus(resolvedLiveState?.taskStatus);

  // Hover preview
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
        {/* Tiny icon / avatar */}
        {isUser ? (
          <span className="relative flex items-center justify-center shrink-0 w-3.5 h-3.5 rounded-full overflow-visible">
            <ChipAvatar
              src={avatarSrc}
              size={14}
              fallback={
                <span className={cn('flex items-center justify-center w-3.5 h-3.5 rounded-sm', style.iconBg)}>
                  <TypeIcon size={8} weight="duotone" className="text-white" />
                </span>
              }
            />
            <PresenceIndicator status={presenceStatus} size="sm" className="!w-1.5 !h-1.5 !ring-1" />
          </span>
        ) : isAgent ? (
          <span className="relative flex items-center justify-center shrink-0 w-3.5 h-3.5 rounded-full overflow-visible">
            <span className="flex items-center justify-center w-3.5 h-3.5 rounded-full overflow-hidden">
              <ChipAvatar
                src={buildAgentAvatarUrl(parsed.id!, 'sm')}
                size={14}
                fallback={
                  <span className={cn(
                    'flex items-center justify-center w-3.5 h-3.5 rounded-full text-[8px]',
                    agent?.avatarEmoji ? 'bg-muted' : cn('text-white', style.iconBg),
                  )}>
                    {agent?.avatarEmoji ?? <TypeIcon size={8} weight="duotone" className="text-white" />}
                  </span>
                }
              />
            </span>
            <span
              className={cn(
                'absolute -bottom-0.5 -right-0.5 flex items-center justify-center w-2 h-2 rounded-full ring-1 ring-background shrink-0',
                style.iconBg,
              )}
              aria-label="Agent"
              title="Agent"
            >
              <Robot size={6} weight="fill" className="text-white" />
            </span>
          </span>
        ) : (
          <span className={cn('flex items-center justify-center shrink-0 w-3.5 h-3.5 rounded-sm', style.iconBg)}>
            <TypeIcon size={8} weight="duotone" className="text-white" />
          </span>
        )}

        {/* Label */}
        <span
          className={cn(
            'text-xs font-medium text-foreground truncate max-w-[100px]',
            isTaskDone && 'line-through text-muted-foreground',
          )}
        >
          {label}
        </span>

        {/* Condensed live indicator */}
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

/**
 * Basic mention chip for ProseMirror NodeView (outside Redux context).
 * No hover preview, no live state - purely visual with type styling.
 */
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
        'cursor-pointer select-none',
        'transition-all duration-200 ease-out',
        'hover:shadow-md hover:scale-[1.01]',
        'active:scale-[0.98]',
        selected && 'ring-2 ring-primary ring-offset-1 ring-offset-background',
      )}
      title={`Open ${typeLabel}: ${label} (Cmd/Ctrl+Click for new tab)`}
    >
      {isUser && parsed.id ? (
        <span className="flex items-center justify-center shrink-0 w-5 h-5 rounded-full overflow-hidden">
          <ChipAvatar
            src={buildAvatarUrl(parsed.id, 'sm')}
            size={20}
            fallback={
              <span className={cn('flex items-center justify-center w-5 h-5 rounded-full text-[8px] font-semibold text-white', style.iconBg)}>
                {getInitials(label)}
              </span>
            }
          />
        </span>
      ) : isAgent && parsed.id ? (
        <span className="flex items-center justify-center shrink-0 w-5 h-5 rounded-full overflow-hidden">
          <ChipAvatar
            src={buildAgentAvatarUrl(parsed.id, 'sm')}
            size={20}
            fallback={
              <span className={cn('flex items-center justify-center w-5 h-5 rounded-full text-[10px] text-white', style.iconBg)}>
                <TypeIcon size={11} weight="duotone" className="text-white" />
              </span>
            }
          />
        </span>
      ) : (
        <span className={cn(
          'flex items-center justify-center shrink-0 w-5 h-5 rounded',
          style.iconBg, 'shadow-sm',
          'transition-transform duration-200 group-hover/chip:scale-110',
        )}>
          <TypeIcon size={11} weight="duotone" className="text-white" />
        </span>
      )}

      <span className="text-sm font-medium text-foreground truncate max-w-[200px] leading-tight">
        {label}
      </span>
    </span>
  );
}

/**
 * Memoize with default shallow comparison. Hook-derived state (mentionDisplay,
 * live state) flows through React context, which forces consumer re-renders on
 * change even inside `memo`. Custom equality functions here would silently
 * shadow that contract; do not add one without re-thinking the provider.
 */
export const MentionChip = memo(MentionChipInner);
export const MentionChipCompact = memo(MentionChipCompactInner);
export const MentionChipBasic = memo(MentionChipBasicInner);
