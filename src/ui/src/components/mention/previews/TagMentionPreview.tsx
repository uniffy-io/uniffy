// Inline-only markup so the card stays HTML-valid as a descendant of `<p>`.
import { useState, useCallback } from 'react';
import {
  ArrowSquareOut,
  CopySimple,
  Check,
  Tag as TagIcon,
} from '@phosphor-icons/react';
import { formatRelativeTime } from '@/shared/utils/dateFormatting';
import { MetaSeparator } from '@/components/mention/previews/ParentBadge';
import { tagColorClasses } from '@/features/tags/utils/colors';
import type { MentionLiveState } from '@/components/mention/types';

interface TagMentionPreviewProps {
  urn: string;
  title: string;
  description?: string;
  liveState: MentionLiveState;
  onClose: () => void;
  onCopyLink: () => void;
}

export function TagMentionPreview({
  urn,
  title,
  description,
  liveState,
  onCopyLink,
}: TagMentionPreviewProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(urn);
    setCopied(true);
    onCopyLink();
    setTimeout(() => setCopied(false), 2000);
  }, [urn, onCopyLink]);

  const palette = tagColorClasses(liveState.tagSlug ?? '', liveState.tagColor ?? undefined);
  const totalUsage = liveState.tagUsageCount ?? 0;
  const slug = liveState.tagSlug ?? '';
  const tagPath = slug ? `/tags/${slug}` : '/tags';
  const lastAddedAt = liveState.tagRecentAssignmentAt?.[0];

  return (
    <>
      <span className="block relative px-4 pr-10 pt-3 pb-1 pl-5">
        <span className="flex items-center gap-2.5">
          <span className={`grid place-items-center shrink-0 w-7 h-7 rounded-md border ${palette.bg} ${palette.text} ${palette.border}`}>
            <TagIcon size={16} weight="duotone" />
          </span>
          <span className="block flex-1 min-w-0">
            <span className="block font-semibold text-sm truncate">{title}</span>
            <span className="flex items-center gap-1.5 flex-wrap">
              {slug && (
                <>
                  <span className="text-[10px] font-mono text-muted-foreground">#{slug}</span>
                  <MetaSeparator />
                </>
              )}
              <span className="text-[10px] font-medium text-primary">Tag</span>
            </span>
          </span>
        </span>
      </span>

      {description && (
        <span className="block px-4 pb-2 pl-[3.375rem]">
          <span className="block text-xs text-muted-foreground/70 leading-relaxed line-clamp-3">{description}</span>
        </span>
      )}

      <span className="flex px-4 pb-2 pl-[3.375rem] items-center gap-2 flex-wrap">
        <span className="text-[11px] font-medium text-foreground">
          {totalUsage === 1 ? '1 item' : `${totalUsage} items`}
        </span>
        {lastAddedAt && (
          <>
            <MetaSeparator />
            <span className="text-[11px] text-muted-foreground">
              Last added {formatRelativeTime(lastAddedAt)}
            </span>
          </>
        )}
      </span>

      <span className="flex px-4 py-1.5 pl-5 bg-muted/30 border-t border-border/50 items-center justify-between">
        <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <TagIcon size={12} weight="duotone" />
          <span>Tag</span>
        </span>
        <span className="flex items-center gap-1">
          <button
            onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); handleCopy(); }}
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}
            className="p-1 rounded-md hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
            title="Copy URN"
          >
            {copied ? <Check size={11} weight="bold" className="text-green-500" /> : <CopySimple size={11} weight="bold" />}
          </button>
          <a
            href={tagPath}
            onClick={(e) => e.stopPropagation()}
            className="flex items-center gap-1 text-xs text-muted-foreground/70 hover:text-foreground"
          >
            <ArrowSquareOut size={11} weight="bold" />
            <span>Open</span>
          </a>
        </span>
      </span>
    </>
  );
}
