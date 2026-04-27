/**
 * Agent Mention Preview Card
 *
 * Shows agent emoji avatar with theme color, name, and description.
 * Uses cyan accent (agent URN color).
 *
 * Markup uses only inline elements so the card stays HTML-valid inside `<p>`.
 */

import { useState, useCallback } from 'react';
import {
  Clock,
  ArrowSquareOut,
  CopySimple,
  Check,
  Robot,
} from '@phosphor-icons/react';
import { formatRelativeTime } from '@/shared/utils/dateFormatting';
import type { MentionLiveState } from '@/components/mention/types';

interface AgentMentionPreviewProps {
  urn: string;
  title: string;
  description?: string;
  liveState: MentionLiveState;
  onClose: () => void;
  onCopyLink: () => void;
}

export function AgentMentionPreview({
  urn,
  title,
  description,
  liveState,
  onCopyLink,
}: AgentMentionPreviewProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(urn);
    setCopied(true);
    onCopyLink();
    setTimeout(() => setCopied(false), 2000);
  }, [urn, onCopyLink]);

  const themeColor = liveState.agentThemeColor || '#06b6d4';

  return (
    <>
      <span className="absolute inset-x-0 top-0 h-16 bg-gradient-to-b from-cyan-500/10 via-cyan-500/5 to-transparent pointer-events-none" />

      {/* Header */}
      <span className="block relative px-4 pr-10 pt-3.5 pb-2 pl-5">
        <span className="flex items-start gap-3">
          <span
            className="flex items-center justify-center shrink-0 w-10 h-10 rounded-lg shadow-md text-lg"
            style={{ backgroundColor: `${themeColor}20` }}
          >
            {liveState.agentEmoji || <Robot size={18} weight="duotone" style={{ color: themeColor }} />}
          </span>
          <span className="block flex-1 min-w-0 pt-0.5">
            <span className="block font-semibold text-sm truncate">{title}</span>
            <span className="text-xs font-medium text-cyan-600 dark:text-cyan-400">Agent</span>
          </span>
        </span>
      </span>

      {/* Description */}
      {description && (
        <span className="block px-4 pb-2.5 pl-5">
          <span className="block text-xs text-muted-foreground leading-relaxed line-clamp-3">{description}</span>
        </span>
      )}

      {/* Footer */}
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
