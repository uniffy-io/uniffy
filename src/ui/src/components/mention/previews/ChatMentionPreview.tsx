// Inline-only markup so the card stays HTML-valid as a descendant of `<p>`.
import { useState, useCallback } from 'react';
import {
  Clock,
  ArrowSquareOut,
  CopySimple,
  Check,
  Hash,
  Lock,
  ChatCircle,
  UsersThree,
} from '@phosphor-icons/react';
import { formatRelativeTime } from '@/shared/utils/dateFormatting';
import { ParentBadge, MetaSeparator } from '@/components/mention/previews/ParentBadge';
import type { MentionLiveState } from '@/components/mention/types';

interface ChatMentionPreviewProps {
  urn: string;
  title: string;
  description?: string;
  liveState: MentionLiveState;
  onClose: () => void;
  onCopyLink: () => void;
}

function ChannelIconBadge({ channelType }: { channelType?: string }) {
  switch (channelType) {
    case 'PRIVATE': return <Lock size={18} weight="duotone" />;
    case 'DIRECT': return <ChatCircle size={18} weight="duotone" />;
    case 'GROUP_DM': return <UsersThree size={18} weight="duotone" />;
    default: return <Hash size={18} weight="duotone" />;
  }
}

function getChannelTypeLabel(channelType?: string): string {
  switch (channelType) {
    case 'PUBLIC': return 'Public channel';
    case 'PRIVATE': return 'Private channel';
    case 'DIRECT': return 'Direct message';
    case 'GROUP_DM': return 'Group message';
    default: return 'Channel';
  }
}

export function ChatMentionPreview({
  urn,
  title,
  description,
  liveState,
  onCopyLink,
}: ChatMentionPreviewProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(urn);
    setCopied(true);
    onCopyLink();
    setTimeout(() => setCopied(false), 2000);
  }, [urn, onCopyLink]);

  const typeLabel = getChannelTypeLabel(liveState.channelType);

  return (
    <>
      <span className="absolute inset-x-0 top-0 h-16 bg-gradient-to-b from-violet-500/10 via-violet-500/5 to-transparent pointer-events-none" />

      <span className="block relative px-4 pr-10 pt-3.5 pb-2 pl-5">
        <span className="flex items-start gap-3">
          <span className="grid place-items-center shrink-0 w-10 h-10 rounded-lg border border-primary/55 bg-primary/10 text-primary">
            <ChannelIconBadge channelType={liveState.channelType} />
          </span>
          <span className="block flex-1 min-w-0 pt-0.5">
            <span className="block font-semibold text-sm truncate">{title}</span>
            <span className="flex items-center gap-1.5 mt-0.5 flex-wrap">
              {liveState.parentLabel && (
                <>
                  <ParentBadge label={liveState.parentLabel} />
                  <MetaSeparator />
                </>
              )}
              <span className="text-xs font-medium text-violet-600 dark:text-violet-400">{typeLabel}</span>
              {(liveState.memberCount ?? 0) > 0 && (
                <>
                  <MetaSeparator />
                  <span className="text-xs text-muted-foreground">
                    {liveState.memberCount} {liveState.memberCount === 1 ? 'member' : 'members'}
                  </span>
                </>
              )}
            </span>
          </span>
        </span>
      </span>

      {description && (
        <span className="block px-4 pb-2.5 pl-5">
          <span className="block text-xs text-muted-foreground leading-relaxed line-clamp-2">{description}</span>
        </span>
      )}

      <span className="flex px-4 py-2 pl-5 bg-muted/30 border-t border-border/50 items-center justify-between">
        <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Clock size={12} weight="duotone" />
          <span>{formatRelativeTime(liveState.updatedAt) || 'No date'}</span>
        </span>
        <span className="flex items-center gap-1">
          <button
            onClick={(e) => { e.stopPropagation(); handleCopy(); }}
            className="p-1 rounded-md hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
            title="Copy URN"
          >
            {copied ? <Check size={12} weight="bold" className="text-green-500" /> : <CopySimple size={12} weight="bold" />}
          </button>
          <span className="flex items-center gap-1 text-xs text-muted-foreground/70">
            <ArrowSquareOut size={11} weight="bold" />
            <span>Open</span>
          </span>
        </span>
      </span>
    </>
  );
}
