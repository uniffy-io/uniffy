// Inline-only markup so the card stays HTML-valid as a descendant of `<p>`.
import { useState, useCallback } from 'react';
import {
  Clock,
  ArrowSquareOut,
  CopySimple,
  Check,
  FileText,
  Image,
  VideoCamera,
  MusicNote,
  FrameCorners,
} from '@phosphor-icons/react';
import { formatRelativeTime, formatFileSize } from '@/shared/utils/dateFormatting';
import { FileProcessingIndicator } from '@/components/mention/LiveIndicators';
import { parseUrn } from '@/shared/utils/urn';
import { useAppSelector } from '@/app/hooks';
import { buildThumbnailUrl } from '@/shared/utils/fileUrls';
import { cn } from '@/shared/utils/cn';
import { ParentBadge, MetaSeparator } from '@/components/mention/previews/ParentBadge';
import { MentionMediaPreview } from '@/components/mention/previews/MentionMediaPreview';
import type { MentionLiveState } from '@/components/mention/types';

interface FileMentionPreviewProps {
  urn: string;
  title: string;
  description?: string;
  liveState: MentionLiveState;
  onClose: () => void;
  onCopyLink: () => void;
  onEmbed?: () => void;
}

function FileIconBadge({ mime }: { mime?: string }) {
  if (mime?.startsWith('image/')) return <Image size={18} weight="duotone" />;
  if (mime?.startsWith('video/')) return <VideoCamera size={18} weight="duotone" />;
  if (mime?.startsWith('audio/')) return <MusicNote size={18} weight="duotone" />;
  return <FileText size={18} weight="duotone" />;
}

function getMediaLabel(mime?: string): string | null {
  if (!mime) return null;
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  return null;
}

export function FileMentionPreview({
  urn,
  title,
  description,
  liveState,
  onCopyLink,
  onEmbed,
}: FileMentionPreviewProps) {
  const [copied, setCopied] = useState(false);
  const [thumbFailed, setThumbFailed] = useState(false);
  const organizationId = useAppSelector((s) => s.auth.currentOrganizationId);
  const parsed = parseUrn(urn);
  const fileId = parsed.id;

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(urn);
    setCopied(true);
    onCopyLink();
    setTimeout(() => setCopied(false), 2000);
  }, [urn, onCopyLink]);

  const mime = liveState.fileMimeType;
  const mediaLabel = getMediaLabel(mime);
  const typeLabel = mime?.split('/')[1]?.toUpperCase() || 'File';
  const sizeLabel = liveState.fileSize ? formatFileSize(liveState.fileSize) : null;
  const isProcessing = liveState.fileProcessingStatus === 'processing' || liveState.fileProcessingStatus === 'pending';
  // With a thumbnail the card is the picture; the metadata drops to a caption.
  const mediaForward = !isProcessing && !thumbFailed && organizationId && fileId && (mime?.startsWith('image/') || mime?.startsWith('video/') || mime === 'application/pdf');
  const thumbnailUrl = organizationId && fileId ? buildThumbnailUrl(organizationId, fileId) : null;

  return (
    <>

      {mediaForward && thumbnailUrl && (
        <MentionMediaPreview
          src={thumbnailUrl}
          isVideo={mime?.startsWith('video/')}
          onError={() => setThumbFailed(true)}
        />
      )}

      {/* Gradient wash when no thumbnail */}
      {!mediaForward && (
        <span className="absolute inset-x-0 top-0 h-16 bg-gradient-to-b from-blue-500/10 via-blue-500/5 to-transparent pointer-events-none" />
      )}

      {/* Header. With a thumbnail this is a caption, so it loses the icon badge
          (the image already says what the file is) and stays on one line. */}
      <span
        className={cn(
          'block relative pr-10',
          mediaForward ? 'px-3 pt-2 pb-1.5 pl-4' : 'px-4 pt-3 pb-2 pl-5',
        )}
      >
        <span className="flex items-start gap-3">
          {!mediaForward && (
            <span className="grid place-items-center shrink-0 w-8 h-8 rounded-lg border border-primary/55 bg-primary/10 text-primary">
              <FileIconBadge mime={mime} />
            </span>
          )}
          <span className="block flex-1 min-w-0 pt-0.5">
            <span className="block font-semibold text-sm truncate">{title}</span>
            <span className="flex items-center gap-1.5 mt-0.5 flex-wrap">
              {liveState.parentLabel && (
                <>
                  <ParentBadge label={liveState.parentLabel} />
                  <MetaSeparator />
                </>
              )}
              <span className="text-xs font-medium text-blue-600 dark:text-blue-400">{typeLabel}</span>
              {sizeLabel && (
                <>
                  <MetaSeparator />
                  <span className="text-xs text-muted-foreground">{sizeLabel}</span>
                </>
              )}
            </span>
          </span>
        </span>
      </span>

      {/* Extracted text snippet (or user description). Suppressed under a
          thumbnail: for a generated image it is the prompt again, and it pushed
          the picture down to a strip. */}
      {description && !isProcessing && !mediaForward && (
        <span className="block px-4 pb-2 pl-[3.875rem]">
          <span className="block text-xs text-muted-foreground/80 leading-relaxed line-clamp-3 whitespace-pre-wrap break-words font-mono">
            {description}
          </span>
        </span>
      )}

      {/* Processing status */}
      {isProcessing && liveState.fileProcessingStatus && (
        <span className="block px-4 pb-2 pl-5">
          <FileProcessingIndicator
            status={liveState.fileProcessingStatus}
            mimeType={mime}
            fileSize={liveState.fileSize}
          />
        </span>
      )}

      {/* Embed button for media */}
      {onEmbed && mediaLabel && !isProcessing && (
        <span className="block px-4 pb-2.5 pl-5">
          <button
            onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); onEmbed(); }}
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}
            className="inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:text-primary/80 transition-colors"
          >
            <FrameCorners size={13} weight="duotone" />
            <span>Embed as {mediaLabel}</span>
          </button>
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
