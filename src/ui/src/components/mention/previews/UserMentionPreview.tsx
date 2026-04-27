/**
 * User Mention Preview Card
 *
 * Shows avatar with presence, name, email, custom status,
 * and message/profile actions. Uses emerald accent.
 *
 * Markup uses only inline elements so the card stays HTML-valid inside `<p>`.
 */

import { useState, useCallback } from 'react';
import {
  ArrowSquareOut,
  CopySimple,
  Check,
} from '@phosphor-icons/react';
import { cn } from '@/shared/utils/cn';
import { parseUrn } from '@/shared/utils/urn';
import { usePresence } from '@/features/presence/hooks/usePresence';
import { useCustomStatus } from '@/features/presence/hooks/useCustomStatus';
import { useAvatarUrl } from '@/shared/hooks/useAvatarUrl';
import { PresenceIndicator } from '@/components/subject/PresenceIndicator';
import { getInitials } from '@/components/subject/utils';
import { formatTimeRemaining } from '@/shared/utils/dateFormatting';
import type { MentionLiveState } from '@/components/mention/types';

interface UserMentionPreviewProps {
  urn: string;
  title: string;
  liveState: MentionLiveState;
  onClose: () => void;
  onCopyLink: () => void;
}

export function UserMentionPreview({
  urn,
  title,
  liveState,
  onCopyLink,
}: UserMentionPreviewProps) {
  const [copied, setCopied] = useState(false);
  const parsed = parseUrn(urn);
  const userId = parsed.id || '';

  const presenceStatus = usePresence(userId);
  const customStatus = useCustomStatus(userId);
  const avatarUrl = useAvatarUrl(userId, 'md');

  const [avatarFailed, setAvatarFailed] = useState(false);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(urn);
    setCopied(true);
    onCopyLink();
    setTimeout(() => setCopied(false), 2000);
  }, [urn, onCopyLink]);

  const presenceLabel =
    presenceStatus === 'online' ? 'Online'
      : presenceStatus === 'away' ? 'Away'
        : presenceStatus === 'dnd' ? 'Do Not Disturb'
          : 'Offline';

  const presenceColor =
    presenceStatus === 'online' ? 'text-green-600 dark:text-green-400'
      : presenceStatus === 'away' ? 'text-amber-600 dark:text-amber-400'
        : presenceStatus === 'dnd' ? 'text-red-600 dark:text-red-400'
          : 'text-muted-foreground';

  return (
    <>
      <span className="absolute inset-x-0 top-0 h-16 bg-gradient-to-b from-emerald-500/10 via-emerald-500/5 to-transparent pointer-events-none" />

      {/* Header */}
      <span className="block relative px-4 pr-10 pt-3.5 pb-2 pl-5">
        <span className="flex items-start gap-3">
          <span className="block relative shrink-0">
            {avatarUrl && !avatarFailed ? (
              <img
                src={avatarUrl}
                alt=""
                className="w-12 h-12 rounded-xl object-cover shadow-lg ring-2 ring-background"
                onError={() => setAvatarFailed(true)}
              />
            ) : (
              <span className="flex items-center justify-center w-12 h-12 rounded-xl shadow-lg bg-emerald-500 text-white text-sm font-semibold">
                {getInitials(title)}
              </span>
            )}
            <PresenceIndicator status={presenceStatus} size="lg" />
          </span>

          <span className="block flex-1 min-w-0 pt-0.5">
            <span className="block font-semibold text-sm truncate">{title}</span>
            {liveState.userEmail && (
              <span className="block text-xs text-muted-foreground truncate">{liveState.userEmail}</span>
            )}
            <span className="flex items-center gap-1.5 mt-1 flex-wrap">
              <span className={cn('text-xs font-medium', presenceColor)}>
                {presenceLabel}
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
            </span>
          </span>
        </span>
      </span>

      {/* Footer */}
      <span className="flex px-4 py-2.5 pl-5 bg-muted/30 border-t border-border/50 items-center gap-2">
        <a
          href="/admin/members"
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowSquareOut size={12} />
          <span>Profile</span>
        </a>
        <span className="flex-1" />
        <button
          onClick={(e) => { e.stopPropagation(); handleCopy(); }}
          className="p-1 rounded-md hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
          title="Copy URN"
        >
          {copied ? <Check size={12} weight="bold" className="text-green-500" /> : <CopySimple size={12} weight="bold" />}
        </button>
      </span>
    </>
  );
}
