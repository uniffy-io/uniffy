/**
 * Live Mention Preview Card
 *
 * Rich hover popover that expands from a MentionChip. Shows a detailed,
 * type-aware preview of the referenced content with live state information.
 *
 * Design language: editorial card with a type-colored accent stripe on the
 * left edge, glass-morphism surface, and type-specific detail sections.
 *
 * Visual structure:
 * +--[accent stripe]-------------------------------+
 * | [icon/avatar]  Title                    [dot]  |
 * |               Type . temporal context          |
 * +------------------------------------------------+
 * | Description or content preview (3 lines max)   |
 * +------------------------------------------------+
 * | Type-specific details (event time, progress)   |
 * +------------------------------------------------+
 * | Updated 2m ago              [Open] [Copy link] |
 * +------------------------------------------------+
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { parseUrn, getUrnTypeLabel, UrnType } from '@/shared/utils/urn';
import {
  Clock,
  ArrowSquareOut,
  Link,
  CalendarDots,
  MapPin,
  FrameCorners,
  CopySimple,
  Check,
  Lock,
} from '@phosphor-icons/react';
import type { UrnPreviewData } from '@/components/editor/plugins/mention/useUrnPreview';
import { stripMarkdown } from '@/features/search/utils/stripMarkdown';
import { getContentTypeConfig } from '@/config/theme/contentTypes';
import { formatRelativeTime, formatTimeRemaining } from '@/shared/utils/dateFormatting';
import { usePresence } from '@/features/presence/hooks/usePresence';
import { useCustomStatus } from '@/features/presence/hooks/useCustomStatus';
import { useAvatarUrl } from '@/shared/hooks/useAvatarUrl';
import { PresenceIndicator } from '@/components/subject/PresenceIndicator';
import {
  TaskStatusIndicator,
  CalendarTemporalIndicator,
  NoteEditingIndicator,
  FileProcessingIndicator,
  ProjectProgressIndicator,
} from '@/components/mention/LiveIndicators';
import { cn } from '@/shared/utils/cn';
import type { MentionLiveState } from '@/components/mention/types';
import type { Icon } from '@phosphor-icons/react';

interface MentionPreviewProps {
  preview: UrnPreviewData | null;
  isLoading: boolean;
  error: string | null;
  position: { x: number; y: number };
  onClose: () => void;
  onEmbed?: () => void;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
  liveState?: MentionLiveState | null;
}

interface TypeTheme {
  icon: Icon;
  gradient: string;
  iconBg: string;
  accentText: string;
  border: string;
}

function getTypeTheme(type: UrnType): TypeTheme {
  const config = getContentTypeConfig(type);
  const theme = config.theme;
  return {
    icon: config.icon,
    gradient: theme.gradient,
    iconBg: theme.iconBg,
    accentText: theme.accentText,
    border: theme.border,
  };
}

function isRecentlyUpdated(dateStr: string | undefined): boolean {
  if (!dateStr) return false;
  return Date.now() - new Date(dateStr).getTime() < 5 * 60 * 1000;
}

function getMediaEmbedLabel(metadata?: Record<string, string>): string | null {
  const mime = metadata?.mime_type;
  if (!mime) return null;
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  return null;
}

function formatEventTimeRange(metadata: Record<string, string>): string {
  const startStr = metadata.start_time;
  const endStr = metadata.end_time;
  const isAllDay = metadata.is_all_day === 'true';

  if (!startStr) return '';

  const start = new Date(startStr);
  const end = endStr ? new Date(endStr) : null;

  const dateOpts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric', year: 'numeric' };
  const timeOpts: Intl.DateTimeFormatOptions = { hour: 'numeric', minute: '2-digit' };

  if (isAllDay) {
    if (!end || start.toDateString() === end.toDateString()) {
      return `${start.toLocaleDateString(undefined, dateOpts)} (all day)`;
    }
    return `${start.toLocaleDateString(undefined, dateOpts)} - ${end.toLocaleDateString(undefined, dateOpts)} (all day)`;
  }

  const startDate = start.toLocaleDateString(undefined, dateOpts);
  const startTime = start.toLocaleTimeString(undefined, timeOpts);

  if (!end) return `${startDate} at ${startTime}`;

  const endTime = end.toLocaleTimeString(undefined, timeOpts);

  if (start.toDateString() === end.toDateString()) {
    return `${startDate}, ${startTime} - ${endTime}`;
  }

  const endDate = end.toLocaleDateString(undefined, dateOpts);
  return `${startDate} ${startTime} - ${endDate} ${endTime}`;
}

function PreviewAvatar({ src, fallback }: { src: string; fallback: React.ReactNode }) {
  const [failed, setFailed] = useState(false);
  if (failed) return <>{fallback}</>;
  return (
    <img
      src={src}
      alt=""
      className="w-11 h-11 rounded-xl object-cover shadow-lg ring-2 ring-background"
      onError={() => setFailed(true)}
    />
  );
}

export function MentionPreview({
  preview,
  isLoading,
  error,
  position,
  onClose,
  onEmbed,
  onMouseEnter,
  onMouseLeave,
  liveState,
}: MentionPreviewProps) {
  const popoverRef = useRef<HTMLDivElement>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [onClose]);

  const handleCopyLink = useCallback(() => {
    if (!preview?.urn) return;
    navigator.clipboard.writeText(preview.urn);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [preview?.urn]);

  const GAP = 8;
  const adjustedLeft = Math.min(Math.max(position.x, 8), window.innerWidth - 340);
  const opensDownward = position.y + GAP + 260 <= window.innerHeight;

  const parsed = preview ? parseUrn(preview.urn) : null;
  const theme = parsed ? getTypeTheme(parsed.type) : getTypeTheme(UrnType.UNKNOWN);
  const TypeIcon = theme.icon;
  const recentlyUpdated = preview ? isRecentlyUpdated(preview.updatedAt) : false;

  const isUserMention = parsed?.type === UrnType.USER && !!parsed.id;
  const presenceStatus = usePresence(isUserMention ? parsed.id! : '');
  const customStatus = useCustomStatus(isUserMention ? parsed.id! : '');
  const userAvatarSrc = useAvatarUrl(isUserMention ? parsed.id! : '', 'md');

  return (
    <div
      ref={popoverRef}
      className="fixed z-[9999]"
      style={{
        left: `${adjustedLeft}px`,
        ...(opensDownward
          ? { top: `${position.y}px`, paddingTop: `${GAP}px` }
          : { bottom: `${window.innerHeight - position.y + GAP}px` }
        ),
      }}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      <div
        className={cn(
          'w-80',
          'bg-card/95 backdrop-blur-xl',
          'text-card-foreground',
          'rounded-xl shadow-2xl',
          'border border-border/50',
          'overflow-hidden',
          'animate-in fade-in-0 zoom-in-95 duration-200',
          opensDownward ? 'slide-in-from-top-2' : 'slide-in-from-bottom-2',
        )}
      >
        {/* Loading skeleton */}
        {isLoading && (
          <div className="p-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-muted animate-pulse" />
              <div className="flex-1 space-y-2">
                <div className="h-4 bg-muted rounded-md animate-pulse w-3/4" />
                <div className="h-3 bg-muted rounded-md animate-pulse w-1/2" />
              </div>
            </div>
            <div className="mt-3 space-y-2">
              <div className="h-3 bg-muted rounded animate-pulse" />
              <div className="h-3 bg-muted rounded animate-pulse w-5/6" />
            </div>
          </div>
        )}

        {/* Error state */}
        {error && !isLoading && (
          <div className="p-4">
            <div className="flex items-center gap-3 text-muted-foreground">
              <div className="w-10 h-10 rounded-lg bg-muted flex items-center justify-center">
                <Link size={18} weight="duotone" />
              </div>
              <div>
                <p className="text-sm font-medium">Unable to load preview</p>
                <p className="text-xs opacity-70">Content may have been moved or deleted</p>
              </div>
            </div>
          </div>
        )}

        {/* Content preview */}
        {preview && !isLoading && !error && (
          <>
            {/* Left accent stripe */}
            <div
              className={cn(
                'absolute left-0 top-0 bottom-0 w-[3px]',
                theme.iconBg,
              )}
            />

            {/* Type gradient wash at top */}
            <div className={cn(
              'absolute inset-x-0 top-0 h-16 bg-gradient-to-b pointer-events-none opacity-60',
              theme.gradient,
            )} />

            {/* Header */}
            <div className="relative px-4 pt-3.5 pb-2 pl-5">
              <div className="flex items-start gap-3">
                {/* Icon badge or avatar */}
                {isUserMention && parsed?.id ? (
                  <div className="relative shrink-0">
                    <PreviewAvatar
                      src={userAvatarSrc}
                      fallback={
                        <div className={cn(
                          'flex items-center justify-center w-11 h-11 rounded-xl shadow-lg',
                          theme.iconBg,
                        )}>
                          <TypeIcon size={20} weight="duotone" className="text-white" />
                        </div>
                      }
                    />
                    <PresenceIndicator status={presenceStatus} size="md" />
                  </div>
                ) : (
                  <div className={cn(
                    'flex items-center justify-center shrink-0 w-10 h-10 rounded-lg shadow-md',
                    theme.iconBg,
                  )}>
                    <TypeIcon size={18} weight="duotone" className="text-white" />
                  </div>
                )}

                {/* Title and subtitle */}
                <div className="flex-1 min-w-0 pt-0.5">
                  <div className="flex items-center gap-2">
                    <h4 className="font-semibold text-sm truncate flex-1">
                      {preview.title}
                    </h4>
                    {recentlyUpdated && (
                      <span className="relative flex shrink-0">
                        <span className="w-1.5 h-1.5 rounded-full bg-primary" />
                        <span className="absolute inset-0 w-1.5 h-1.5 rounded-full bg-primary animate-ping opacity-50" />
                      </span>
                    )}
                  </div>

                  {/* Subtitle: type, presence, or live status */}
                  <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                    {isUserMention ? (
                      <>
                        <span className={cn(
                          'text-xs font-medium capitalize',
                          presenceStatus === 'online' ? 'text-green-600 dark:text-green-400'
                            : presenceStatus === 'away' ? 'text-amber-600 dark:text-amber-400'
                            : presenceStatus === 'dnd' ? 'text-red-600 dark:text-red-400'
                            : 'text-muted-foreground',
                        )}>
                          {presenceStatus === 'dnd' ? 'Do Not Disturb' : presenceStatus}
                        </span>
                        {customStatus && (
                          <>
                            <span className="text-muted-foreground/40">.</span>
                            <span className="inline-flex items-center gap-1 text-xs text-muted-foreground truncate">
                              {customStatus.emoji && <span>{customStatus.emoji}</span>}
                              <span className="truncate">
                                {customStatus.text}
                                {customStatus.expiresAt && (
                                  <span className="text-muted-foreground/60">
                                    {' '}{formatTimeRemaining(customStatus.expiresAt)}
                                  </span>
                                )}
                              </span>
                            </span>
                          </>
                        )}
                      </>
                    ) : (
                      <>
                        <span className={cn('text-xs font-medium', theme.accentText)}>
                          {getUrnTypeLabel(preview.urn)}
                        </span>

                        {/* Inline live status in subtitle */}
                        {liveState?.taskStatus && (
                          <>
                            <span className="text-muted-foreground/40">.</span>
                            <TaskStatusIndicator status={liveState.taskStatus} />
                          </>
                        )}
                        {liveState?.eventStartTime && (
                          <>
                            <span className="text-muted-foreground/40">.</span>
                            <CalendarTemporalIndicator
                              startTime={liveState.eventStartTime}
                              endTime={liveState.eventEndTime}
                              isAllDay={liveState.eventIsAllDay}
                            />
                          </>
                        )}
                        {liveState?.noteIsBeingEdited && (
                          <>
                            <span className="text-muted-foreground/40">.</span>
                            <NoteEditingIndicator editorName={liveState.noteEditorName} />
                          </>
                        )}
                      </>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* Description / content preview */}
            {preview.description && (
              <div className="px-4 pb-2.5 pl-5">
                <p className="text-sm text-muted-foreground leading-relaxed line-clamp-3">
                  {stripMarkdown(preview.description)}
                </p>
              </div>
            )}

            {/* Type-specific detail sections */}

            {/* Calendar event details */}
            {preview.type === UrnType.CALENDAR_EVENT && preview.metadata?.start_time && (
              <div className="px-4 pb-2.5 pl-5 space-y-1">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <CalendarDots size={14} weight="duotone" className="text-rose-500 shrink-0" />
                  <span className="text-xs">{formatEventTimeRange(preview.metadata)}</span>
                </div>
                {preview.metadata.location && (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <MapPin size={14} weight="duotone" className="text-rose-500 shrink-0" />
                    <span className="text-xs truncate">{preview.metadata.location}</span>
                  </div>
                )}
              </div>
            )}

            {/* Task details */}
            {liveState?.taskDueDate && parsed?.type === UrnType.TASK && (
              <div className="px-4 pb-2.5 pl-5">
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Clock size={13} weight="duotone" className="text-teal-500 shrink-0" />
                  <span>Due {new Date(liveState.taskDueDate).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span>
                  {liveState.taskAssignee && (
                    <>
                      <span className="text-muted-foreground/40">.</span>
                      <span className="truncate">{liveState.taskAssignee}</span>
                    </>
                  )}
                </div>
              </div>
            )}

            {/* Project progress */}
            {liveState && parsed?.type === UrnType.PROJECT && (liveState.projectTotalTasks ?? 0) > 0 && (
              <div className="px-4 pb-2.5 pl-5">
                <div className="flex items-center gap-3">
                  <ProjectProgressIndicator
                    completed={liveState.projectCompletedTasks ?? 0}
                    total={liveState.projectTotalTasks!}
                  />
                  <span className="text-xs text-muted-foreground">
                    {liveState.projectCompletedTasks}/{liveState.projectTotalTasks} tasks
                  </span>
                </div>
              </div>
            )}

            {/* File processing / embed */}
            {liveState?.fileProcessingStatus && parsed?.type === UrnType.FILE && (
              <div className="px-4 pb-2 pl-5">
                <FileProcessingIndicator
                  status={liveState.fileProcessingStatus}
                  mimeType={liveState.fileMimeType}
                  fileSize={liveState.fileSize}
                />
              </div>
            )}

            {onEmbed && preview.type === UrnType.FILE && (() => {
              const mediaLabel = getMediaEmbedLabel(preview.metadata);
              if (!mediaLabel) return null;
              return (
                <div className="px-4 pb-2 pl-5">
                  <button
                    onClick={(e) => { e.stopPropagation(); onEmbed(); }}
                    className="flex items-center gap-1.5 text-xs font-medium text-primary hover:text-primary/80 transition-colors"
                  >
                    <FrameCorners size={13} weight="duotone" />
                    <span>Embed as {mediaLabel}</span>
                  </button>
                </div>
              );
            })()}

            {/* Footer */}
            <div className="px-4 py-2 pl-5 bg-muted/30 border-t border-border/50 flex items-center justify-between">
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Clock size={12} weight="duotone" />
                <span>{formatRelativeTime(preview.updatedAt) || 'No date'}</span>
                {liveState?.updatedByName && (
                  <>
                    <span className="text-muted-foreground/40">.</span>
                    <span className="truncate max-w-[80px]">{liveState.updatedByName}</span>
                  </>
                )}
              </div>
              <div className="flex items-center gap-1">
                <button
                  onClick={(e) => { e.stopPropagation(); handleCopyLink(); }}
                  className="p-1 rounded-md hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
                  title="Copy URN"
                >
                  {copied ? (
                    <Check size={12} weight="bold" className="text-green-500" />
                  ) : (
                    <CopySimple size={12} weight="bold" />
                  )}
                </button>
                <span className="flex items-center gap-1 text-xs text-muted-foreground/70">
                  <ArrowSquareOut size={11} weight="bold" />
                  <span>Open</span>
                </span>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
