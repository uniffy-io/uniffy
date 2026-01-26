/**
 * Mention Preview Component
 *
 * Shows a rich preview popover when hovering over mention chips.
 * Features glassmorphism, animated entrance, and type-colored headers.
 */

import { useEffect, useRef } from 'react';
import { parseUrn, getUrnTypeLabel, UrnType } from '@/utils/urn';
import type { Icon } from '@phosphor-icons/react';
import {
  Clock,
  ArrowSquareOut,
  Link,
} from '@phosphor-icons/react';
import type { UrnPreviewData } from './useUrnPreview';
import { stripMarkdown } from '@/features/search/utils/stripMarkdown';
import { getContentTypeConfig } from '@/theme/contentTypes';

interface MentionPreviewProps {
  preview: UrnPreviewData | null;
  isLoading: boolean;
  error: string | null;
  position: { x: number; y: number };
  onClose: () => void;
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

export function MentionPreview({
  preview,
  isLoading,
  error,
  position,
  onClose
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

  // Calculate position to stay within viewport
  const adjustedPosition = {
    left: Math.min(position.x, window.innerWidth - 340),
    top: position.y + 8,
  };

  // Check if preview would go below viewport
  if (adjustedPosition.top + 220 > window.innerHeight) {
    adjustedPosition.top = position.y - 228;
  }

  const parsed = preview ? parseUrn(preview.urn) : null;
  const theme = parsed ? getTypeTheme(parsed.type) : getTypeTheme(UrnType.UNKNOWN);
  const Icon = theme.icon;
  const recentlyUpdated = preview ? isRecentlyUpdated(preview.updatedAt) : false;

  return (
    <div
      ref={popoverRef}
      className={`
        fixed z-[9999] w-80
        bg-card/95 backdrop-blur-xl
        text-card-foreground
        rounded-xl shadow-2xl
        border border-border/50
        overflow-hidden
        animate-in fade-in-0 zoom-in-95 slide-in-from-top-2
        duration-200
      `}
      style={{
        left: `${adjustedPosition.left}px`,
        top: `${adjustedPosition.top}px`,
      }}
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
              {/* Icon badge */}
              <div className={`
                flex items-center justify-center
                w-11 h-11 rounded-xl
                ${theme.iconBg}
                shadow-lg
                ring-2 ring-background
              `}>
                <Icon size={20} weight="duotone" className="text-white" />
              </div>

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
  );
}
