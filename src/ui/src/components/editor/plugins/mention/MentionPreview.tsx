/**
 * Mention Preview Component
 *
 * Shows a rich preview popover when hovering over mention chips.
 * Features glassmorphism, animated entrance, and type-colored headers.
 */

import { useState, useEffect, useRef } from 'react';
import { parseUrn, getUrnTypeLabel, UrnType } from '@/shared/utils/urn';
import type { Icon } from '@phosphor-icons/react';
import {
  Clock,
  ArrowSquareOut,
  Link,
  CalendarDots,
  MapPin,
  FrameCorners,
} from '@phosphor-icons/react';
import type { UrnPreviewData } from '@/components/editor/plugins/mention/useUrnPreview';
import { stripMarkdown } from '@/features/search/utils/stripMarkdown';
import { getContentTypeConfig } from '@/config/theme/contentTypes';

interface MentionPreviewProps {
  preview: UrnPreviewData | null;
  isLoading: boolean;
  error: string | null;
  position: { x: number; y: number };
  onClose: () => void;
  onEmbed?: () => void;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
}

interface TypeTheme {
  icon: Icon;
  gradient: string;
  iconBg: string;
  accentText: string;
  dotColor: string;
}

/**
 * Get theme configuration for URN type using centralized config
 */
function getTypeTheme(type: UrnType): TypeTheme {
  const config = getContentTypeConfig(type);
  const theme = config.theme;

  // Derive dotColor from iconBg (extract the main color)
  const dotColorMatch = theme.iconBg.match(/from-(\w+-\d+)/);
  const dotColor = dotColorMatch ? `bg-${dotColorMatch[1]}` : 'bg-gray-400';

  return {
    icon: config.icon,
    gradient: theme.gradient,
    iconBg: theme.iconBg,
    accentText: theme.accentText,
    dotColor,
  };
}

/**
 * Format relative time with more detail
 */
function formatRelativeTime(dateStr: string | undefined): string {
  if (!dateStr) return '';

  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return `${diffDays}d ago`;

  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/**
 * Check if content was recently updated (within 5 minutes)
 */
function isRecentlyUpdated(dateStr: string | undefined): boolean {
  if (!dateStr) return false;
  const date = new Date(dateStr);
  const now = new Date();
  return now.getTime() - date.getTime() < 5 * 60 * 1000;
}

/**
 * Get a human-readable media type label from MIME type metadata.
 * Returns null if the file is not a supported media type.
 */
function getMediaEmbedLabel(metadata?: Record<string, string>): string | null {
  const mime = metadata?.mime_type;
  if (!mime) return null;
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  return null;
}

/**
 * Format an event time range from metadata for display.
 * Handles all-day events, same-day events, and multi-day events.
 */
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

  if (!end) {
    return `${startDate} at ${startTime}`;
  }

  const endTime = end.toLocaleTimeString(undefined, timeOpts);

  // Same day
  if (start.toDateString() === end.toDateString()) {
    return `${startDate}, ${startTime} - ${endTime}`;
  }

  // Multi-day
  const endDate = end.toLocaleDateString(undefined, dateOpts);
  return `${startDate} ${startTime} - ${endDate} ${endTime}`;
}

/** Avatar with error fallback for user mention previews */
function PreviewUserAvatar({ userId, fallback }: { userId: string; fallback: React.ReactNode }) {
  const [failed, setFailed] = useState(false);
  if (failed) return <>{fallback}</>;
  return (
    <img
      src={`/api/avatars/${userId}/md`}
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
}: MentionPreviewProps) {
  const popoverRef = useRef<HTMLDivElement>(null);

  // Close on click outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        onClose();
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [onClose]);

  // Gap between the chip bottom edge and the visible popover (px)
  const GAP = 8;

  // Calculate position to stay within viewport
  const adjustedLeft = Math.min(position.x, window.innerWidth - 340);
  const opensDownward = position.y + GAP + 220 <= window.innerHeight;

  const parsed = preview ? parseUrn(preview.urn) : null;
  const theme = parsed ? getTypeTheme(parsed.type) : getTypeTheme(UrnType.UNKNOWN);
  const Icon = theme.icon;
  const recentlyUpdated = preview ? isRecentlyUpdated(preview.updatedAt) : false;

  return (
    // Invisible hover bridge: extends from the chip edge through the gap to the
    // popover so the mouse never leaves the hover area while traveling between them.
    <div
      ref={popoverRef}
      className="fixed z-[9999]"
      style={{
        left: `${adjustedLeft}px`,
        // Start at chip edge; pad the gap side so it covers the empty space
        ...(opensDownward
          ? { top: `${position.y}px`, paddingTop: `${GAP}px` }
          : { top: `${position.y - GAP - 220}px`, paddingBottom: `${GAP}px` }
        ),
      }}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
    <div
      className={`
        w-80
        bg-card/95 backdrop-blur-xl
        text-card-foreground
        rounded-xl shadow-2xl
        border border-border/50
        overflow-hidden
        animate-in fade-in-0 zoom-in-95 slide-in-from-top-2
        duration-200
      `}
    >
      {/* Loading state */}
      {isLoading && (
        <div className="p-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-muted animate-pulse" />
            <div className="flex-1 space-y-2">
              <div className="h-4 bg-muted rounded-lg animate-pulse w-3/4" />
              <div className="h-3 bg-muted rounded-lg animate-pulse w-1/2" />
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
            <div className="w-10 h-10 rounded-xl bg-muted flex items-center justify-center">
              <Link size={20} weight="duotone" />
            </div>
            <div>
              <p className="text-sm font-medium">Unable to load preview</p>
              <p className="text-xs opacity-70">The content may have been moved or deleted</p>
            </div>
          </div>
        </div>
      )}

      {/* Preview content */}
      {preview && !isLoading && !error && (
        <>
          {/* Gradient header background */}
          <div className={`absolute inset-x-0 top-0 h-20 bg-gradient-to-b ${theme.gradient} pointer-events-none`} />

          {/* Header */}
          <div className="relative p-4 pb-2">
            <div className="flex items-start gap-3">
              {/* Icon badge or avatar */}
              {preview.type === UrnType.USER && parsed?.id ? (
                <PreviewUserAvatar
                  userId={parsed.id}
                  fallback={
                    <div className={`
                      flex items-center justify-center
                      w-11 h-11 rounded-xl
                      ${theme.iconBg}
                      shadow-lg
                      ring-2 ring-background
                    `}>
                      <Icon size={20} weight="duotone" className="text-white" />
                    </div>
                  }
                />
              ) : (
              <div className={`
                flex items-center justify-center
                w-11 h-11 rounded-xl
                ${theme.iconBg}
                shadow-lg
                ring-2 ring-background
              `}>
                <Icon size={20} weight="duotone" className="text-white" />
              </div>
              )}

              {/* Title and type */}
              <div className="flex-1 min-w-0 pt-0.5">
                <div className="flex items-center gap-2">
                  <h4 className="font-semibold text-sm truncate flex-1">
                    {preview.title}
                  </h4>
                  {recentlyUpdated && (
                    <span className={`w-2 h-2 rounded-full ${theme.dotColor} animate-pulse`} title="Recently updated" />
                  )}
                </div>
                <div className="flex items-center gap-1.5 mt-0.5">
                  <span className={`text-xs font-medium ${theme.accentText}`}>
                    {getUrnTypeLabel(preview.urn)}
                  </span>
                  <span className="text-muted-foreground/40">·</span>
                  <span className="text-xs text-muted-foreground">
                    Click to open
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Description/Content preview */}
          {preview.description && (
            <div className="px-4 pb-3">
              <p className="text-sm text-muted-foreground leading-relaxed line-clamp-3">
                {stripMarkdown(preview.description)}
              </p>
            </div>
          )}

          {/* Calendar event details */}
          {preview.type === UrnType.CALENDAR_EVENT && preview.metadata?.start_time && (
            <div className="px-4 pb-3 space-y-1.5">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <CalendarDots size={16} weight="duotone" className="text-rose-500 shrink-0" />
                <span>{formatEventTimeRange(preview.metadata)}</span>
              </div>
              {preview.metadata.location && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <MapPin size={16} weight="duotone" className="text-rose-500 shrink-0" />
                  <span className="truncate">{preview.metadata.location}</span>
                </div>
              )}
            </div>
          )}

          {/* Embed action for media files */}
          {onEmbed && preview.type === UrnType.FILE && (() => {
            const mediaLabel = getMediaEmbedLabel(preview.metadata);
            if (!mediaLabel) return null;
            return (
              <div className="px-4 pb-2">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onEmbed();
                  }}
                  className="flex items-center gap-1.5 text-xs font-medium text-primary hover:text-primary/80 transition-colors"
                >
                  <FrameCorners size={14} weight="duotone" />
                  <span>Embed as {mediaLabel}</span>
                </button>
              </div>
            );
          })()}

          {/* Footer with metadata */}
          <div className="px-4 py-2.5 bg-muted/30 border-t border-border/50 flex items-center justify-between">
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Clock size={14} weight="duotone" />
              <span>{formatRelativeTime(preview.updatedAt) || 'No date'}</span>
            </div>
            <div className="flex items-center gap-1 text-xs text-muted-foreground opacity-70 group-hover:opacity-100">
              <ArrowSquareOut size={12} weight="bold" />
              <span>Open</span>
            </div>
          </div>
        </>
      )}
    </div>
    </div>
  );
}
