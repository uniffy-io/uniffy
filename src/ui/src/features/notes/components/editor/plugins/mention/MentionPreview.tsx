/**
 * Mention Preview Component
 *
 * Shows a rich preview popover when hovering over mention chips.
 * Features glassmorphism, animated entrance, and type-colored headers.
 */

import { useEffect, useRef } from 'react';
import { parseUrn, getUrnTypeLabel, UrnType } from '@/utils/urn';
import {
  FileText,
  Folder,
  ChatTeardropDots,
  User,
  BookOpen,
  CalendarDots,
  Key,
  Cube,
  Link,
  Clock,
  ArrowSquareOut,
} from '@phosphor-icons/react';
import type { UrnPreviewData } from './useUrnPreview';
import { stripMarkdown } from '@/features/search/utils/stripMarkdown';

interface MentionPreviewProps {
  preview: UrnPreviewData | null;
  isLoading: boolean;
  error: string | null;
  position: { x: number; y: number };
  onClose: () => void;
}

interface TypeTheme {
  icon: typeof FileText;
  gradient: string;
  iconBg: string;
  accentText: string;
  dotColor: string;
}

/**
 * Get theme configuration for URN type
 */
function getTypeTheme(type: UrnType): TypeTheme {
  const themeMap: Record<UrnType, TypeTheme> = {
    [UrnType.NOTE]: {
      icon: FileText,
      gradient: 'from-primary/20 via-primary/10 to-transparent',
      iconBg: 'bg-gradient-to-br from-primary to-primary/80',
      accentText: 'text-primary',
      dotColor: 'bg-primary',
    },
    [UrnType.FILE]: {
      icon: Folder,
      gradient: 'from-blue-500/20 via-blue-500/10 to-transparent',
      iconBg: 'bg-gradient-to-br from-blue-500 to-blue-600',
      accentText: 'text-blue-600 dark:text-blue-400',
      dotColor: 'bg-blue-500',
    },
    [UrnType.CHAT]: {
      icon: ChatTeardropDots,
      gradient: 'from-violet-500/20 via-violet-500/10 to-transparent',
      iconBg: 'bg-gradient-to-br from-violet-500 to-violet-600',
      accentText: 'text-violet-600 dark:text-violet-400',
      dotColor: 'bg-violet-500',
    },
    [UrnType.USER]: {
      icon: User,
      gradient: 'from-emerald-500/20 via-emerald-500/10 to-transparent',
      iconBg: 'bg-gradient-to-br from-emerald-500 to-emerald-600',
      accentText: 'text-emerald-600 dark:text-emerald-400',
      dotColor: 'bg-emerald-500',
    },
    [UrnType.BOOK]: {
      icon: BookOpen,
      gradient: 'from-amber-500/20 via-amber-500/10 to-transparent',
      iconBg: 'bg-gradient-to-br from-amber-500 to-amber-600',
      accentText: 'text-amber-600 dark:text-amber-400',
      dotColor: 'bg-amber-500',
    },
    [UrnType.CALENDAR_EVENT]: {
      icon: CalendarDots,
      gradient: 'from-rose-500/20 via-rose-500/10 to-transparent',
      iconBg: 'bg-gradient-to-br from-rose-500 to-rose-600',
      accentText: 'text-rose-600 dark:text-rose-400',
      dotColor: 'bg-rose-500',
    },
    [UrnType.PASSWORD]: {
      icon: Key,
      gradient: 'from-red-500/20 via-red-500/10 to-transparent',
      iconBg: 'bg-gradient-to-br from-red-500 to-red-600',
      accentText: 'text-red-600 dark:text-red-400',
      dotColor: 'bg-red-500',
    },
    [UrnType.SPACE]: {
      icon: Cube,
      gradient: 'from-indigo-500/20 via-indigo-500/10 to-transparent',
      iconBg: 'bg-gradient-to-br from-indigo-500 to-indigo-600',
      accentText: 'text-indigo-600 dark:text-indigo-400',
      dotColor: 'bg-indigo-500',
    },
    [UrnType.UNKNOWN]: {
      icon: Link,
      gradient: 'from-gray-500/20 via-gray-500/10 to-transparent',
      iconBg: 'bg-gradient-to-br from-gray-400 to-gray-500',
      accentText: 'text-muted-foreground',
      dotColor: 'bg-gray-400',
    },
  };
  return themeMap[type] || themeMap[UrnType.UNKNOWN];
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
