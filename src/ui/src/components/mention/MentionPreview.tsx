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

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { parseUrn, getUrnTypeLabel, UrnType } from '@/shared/utils/urn';
import {
  Clock,
  ArrowSquareOut,
  Link,
  CopySimple,
  Check,
} from '@phosphor-icons/react';
import type { UrnPreviewData } from '@/components/editor/plugins/mention/useUrnPreview';
import { stripMarkdown } from '@/features/search/utils/stripMarkdown';
import { buildLiveStateFromMetadata } from '@/components/mention/buildLiveState';
import { getContentTypeConfig } from '@/config/theme/contentTypes';
import { formatRelativeTime } from '@/shared/utils/dateFormatting';
import { cn } from '@/shared/utils/cn';
import type { MentionLiveState } from '@/components/mention/types';
import {
  TaskMentionPreview,
  CalendarMentionPreview,
  ProjectMentionPreview,
  FileMentionPreview,
  NoteMentionPreview,
  UserMentionPreview,
  ChatMentionPreview,
  AgentMentionPreview,
} from '@/components/mention/previews';
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

/** Known types that have dedicated preview components */
const KNOWN_PREVIEW_TYPES = new Set<UrnType>([
  UrnType.TASK, UrnType.CALENDAR_EVENT, UrnType.PROJECT, UrnType.FILE,
  UrnType.NOTE, UrnType.USER, UrnType.CHAT, UrnType.AGENT,
]);

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

  // Build effective liveState: merge provider state with preview.metadata fallback
  const effectiveLiveState = useMemo((): MentionLiveState | null => {
    if (liveState) return liveState;
    if (!preview?.metadata) return null;
    return buildLiveStateFromMetadata(preview.urn, preview.title, preview.metadata);
  }, [liveState, preview]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [onClose]);

  const previewUrn = preview?.urn;
  const handleCopyLink = useCallback(() => {
    if (!previewUrn) return;
    navigator.clipboard.writeText(previewUrn);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [previewUrn]);

  const GAP = 8;
  const adjustedLeft = Math.min(Math.max(position.x, 8), window.innerWidth - 340);
  const opensDownward = position.y + GAP + 260 <= window.innerHeight;

  const parsed = preview ? parseUrn(preview.urn) : null;
  const theme = parsed ? getTypeTheme(parsed.type) : getTypeTheme(UrnType.UNKNOWN);
  const TypeIcon = theme.icon;

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

        {/* Type-specific preview cards */}
        {preview && !isLoading && !error && effectiveLiveState && parsed?.type === UrnType.TASK && (
          <TaskMentionPreview
            urn={preview.urn}
            title={preview.title}
            description={preview.description ? stripMarkdown(preview.description) : undefined}
            liveState={effectiveLiveState!}
            onClose={onClose}
            onCopyLink={handleCopyLink}
          />
        )}
        {preview && !isLoading && !error && effectiveLiveState && parsed?.type === UrnType.CALENDAR_EVENT && (
          <CalendarMentionPreview
            urn={preview.urn}
            title={preview.title}
            description={preview.description ? stripMarkdown(preview.description) : undefined}
            liveState={effectiveLiveState!}
            onClose={onClose}
            onCopyLink={handleCopyLink}
          />
        )}
        {preview && !isLoading && !error && effectiveLiveState && parsed?.type === UrnType.PROJECT && (
          <ProjectMentionPreview
            urn={preview.urn}
            title={preview.title}
            description={preview.description ? stripMarkdown(preview.description) : undefined}
            liveState={effectiveLiveState!}
            onClose={onClose}
            onCopyLink={handleCopyLink}
          />
        )}
        {preview && !isLoading && !error && effectiveLiveState && parsed?.type === UrnType.FILE && (
          <FileMentionPreview
            urn={preview.urn}
            title={preview.title}
            description={preview.description ? stripMarkdown(preview.description) : undefined}
            liveState={effectiveLiveState!}
            onClose={onClose}
            onCopyLink={handleCopyLink}
            onEmbed={onEmbed}
          />
        )}
        {preview && !isLoading && !error && effectiveLiveState && parsed?.type === UrnType.NOTE && (
          <NoteMentionPreview
            urn={preview.urn}
            title={preview.title}
            description={preview.description ? stripMarkdown(preview.description) : undefined}
            liveState={effectiveLiveState!}
            onClose={onClose}
            onCopyLink={handleCopyLink}
          />
        )}
        {preview && !isLoading && !error && effectiveLiveState && parsed?.type === UrnType.USER && (
          <UserMentionPreview
            urn={preview.urn}
            title={preview.title}
            liveState={effectiveLiveState!}
            onClose={onClose}
            onCopyLink={handleCopyLink}
          />
        )}
        {preview && !isLoading && !error && effectiveLiveState && parsed?.type === UrnType.CHAT && (
          <ChatMentionPreview
            urn={preview.urn}
            title={preview.title}
            description={preview.description ? stripMarkdown(preview.description) : undefined}
            liveState={effectiveLiveState!}
            onClose={onClose}
            onCopyLink={handleCopyLink}
          />
        )}
        {preview && !isLoading && !error && effectiveLiveState && parsed?.type === UrnType.AGENT && (
          <AgentMentionPreview
            urn={preview.urn}
            title={preview.title}
            description={preview.description ? stripMarkdown(preview.description) : undefined}
            liveState={effectiveLiveState!}
            onClose={onClose}
            onCopyLink={handleCopyLink}
          />
        )}

        {/* Generic fallback for unknown types or missing live state */}
        {preview && !isLoading && !error && !(effectiveLiveState && parsed && KNOWN_PREVIEW_TYPES.has(parsed.type)) && (
          <>
            <div className={cn('absolute left-0 top-0 bottom-0 w-[3px]', theme.iconBg)} />
            <div className={cn('absolute inset-x-0 top-0 h-16 bg-gradient-to-b pointer-events-none opacity-60', theme.gradient)} />

            <div className="relative px-4 pt-3.5 pb-2 pl-5">
              <div className="flex items-start gap-3">
                <div className={cn('flex items-center justify-center shrink-0 w-10 h-10 rounded-lg shadow-md', theme.iconBg)}>
                  <TypeIcon size={18} weight="duotone" className="text-white" />
                </div>
                <div className="flex-1 min-w-0 pt-0.5">
                  <h4 className="font-semibold text-sm truncate">{preview.title}</h4>
                  <span className={cn('text-xs font-medium', theme.accentText)}>
                    {getUrnTypeLabel(preview.urn)}
                  </span>
                </div>
              </div>
            </div>

            {preview.description && (
              <div className="px-4 pb-2.5 pl-5">
                <p className="text-sm text-muted-foreground leading-relaxed line-clamp-3">
                  {stripMarkdown(preview.description)}
                </p>
              </div>
            )}

            <div className="px-4 py-2 pl-5 bg-muted/30 border-t border-border/50 flex items-center justify-between">
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Clock size={12} weight="duotone" />
                <span>{formatRelativeTime(preview.updatedAt) || 'No date'}</span>
              </div>
              <div className="flex items-center gap-1">
                <button
                  onClick={(e) => { e.stopPropagation(); handleCopyLink(); }}
                  className="p-1 rounded-md hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
                  title="Copy URN"
                >
                  {copied ? <Check size={12} weight="bold" className="text-green-500" /> : <CopySimple size={12} weight="bold" />}
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
