/**
 * Note Mention Preview Card
 *
 * Shows note type indicator, title, content preview (first ~200 chars),
 * tags, and editing indicator. Uses primary/violet accent.
 *
 * Markup uses only inline elements (`<span>` with `block`/`flex` Tailwind
 * classes) so the card is HTML-valid as a descendant of `<p>` when chat
 * markdown wraps mentions inline.
 */

import { useState, useCallback } from 'react';
import {
  Clock,
  ArrowSquareOut,
  CopySimple,
  Check,
  Note,
  Folder,
  Layout,
  File,
  Tag,
} from '@phosphor-icons/react';
import { formatRelativeTime } from '@/shared/utils/dateFormatting';
import { NoteEditingIndicator } from '@/components/mention/LiveIndicators';
import type { MentionLiveState } from '@/components/mention/types';

interface NoteMentionPreviewProps {
  urn: string;
  title: string;
  description?: string;
  liveState: MentionLiveState;
  onClose: () => void;
  onCopyLink: () => void;
}

function getNoteTypeLabel(nodeType?: string): string {
  switch (nodeType) {
    case 'FOLDER': return 'Folder';
    case 'TEMPLATE': return 'Template';
    case 'CANVAS': return 'Canvas';
    default: return 'Note';
  }
}

function NoteTypeIcon({ nodeType }: { nodeType?: string }) {
  switch (nodeType) {
    case 'FOLDER': return <Folder size={16} weight="duotone" />;
    case 'TEMPLATE': return <File size={16} weight="duotone" />;
    case 'CANVAS': return <Layout size={16} weight="duotone" />;
    default: return <Note size={16} weight="duotone" />;
  }
}

export function NoteMentionPreview({
  urn,
  title,
  description,
  liveState,
  onCopyLink,
}: NoteMentionPreviewProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(urn);
    setCopied(true);
    onCopyLink();
    setTimeout(() => setCopied(false), 2000);
  }, [urn, onCopyLink]);

  const typeLabel = getNoteTypeLabel(liveState.noteNodeType);

  return (
    <>
      <span className="absolute inset-x-0 top-0 h-12 bg-gradient-to-b from-primary/10 via-primary/5 to-transparent pointer-events-none" />

      {/* Header row */}
      <span className="block relative px-4 pr-10 pt-3 pb-1 pl-5">
        <span className="flex items-center gap-2.5">
          <span className="grid place-items-center shrink-0 w-7 h-7 rounded-md border border-primary/55 bg-primary/10 text-primary">
            <NoteTypeIcon nodeType={liveState.noteNodeType} />
          </span>
          <span className="block flex-1 min-w-0">
            <span className="block font-semibold text-sm truncate">{title}</span>
            <span className="flex items-center gap-1.5">
              <span className="text-[10px] font-medium text-primary">{typeLabel}</span>
              {liveState.noteIsBeingEdited && (
                <>
                  <span className="text-muted-foreground/40">.</span>
                  <NoteEditingIndicator editorName={liveState.noteEditorName} />
                </>
              )}
            </span>
          </span>
        </span>
      </span>

      {/* Content preview - aligned with title (icon 28px + gap 10px + pl-5 = pl offset) */}
      {description && (
        <span className="block px-4 pb-2 pl-[3.375rem]">
          <span className="block text-xs text-muted-foreground/70 leading-relaxed line-clamp-3">{description}</span>
        </span>
      )}

      {/* Tags */}
      {liveState.contentTags && liveState.contentTags.length > 0 && (
        <span className="flex px-4 pb-2 pl-[3.375rem] items-center gap-1.5 flex-wrap">
          <Tag size={10} weight="duotone" className="text-muted-foreground shrink-0" />
          {liveState.contentTags.slice(0, 4).map((tag) => (
            <span
              key={tag}
              className="inline-flex items-center rounded-full px-1.5 py-px bg-muted text-[10px] text-muted-foreground font-medium"
            >
              {tag}
            </span>
          ))}
          {liveState.contentTags.length > 4 && (
            <span className="text-[10px] text-muted-foreground">
              +{liveState.contentTags.length - 4}
            </span>
          )}
        </span>
      )}

      {/* Footer */}
      <span className="flex px-4 py-1.5 pl-5 bg-muted/30 border-t border-border/50 items-center justify-between">
        <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Clock size={12} weight="duotone" />
          <span>{formatRelativeTime(liveState.updatedAt) || 'No date'}</span>
          {liveState.updatedByName && (
            <>
              <span className="text-muted-foreground/40">.</span>
              <span className="truncate max-w-[80px]">{liveState.updatedByName}</span>
            </>
          )}
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
          <span className="flex items-center gap-1 text-xs text-muted-foreground/70">
            <ArrowSquareOut size={11} weight="bold" />
            <span>Open</span>
          </span>
        </span>
      </span>
    </>
  );
}
