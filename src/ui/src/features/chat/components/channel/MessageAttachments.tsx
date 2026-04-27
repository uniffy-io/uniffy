import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { FileArrowDown, ArrowsOut } from '@phosphor-icons/react';
import { cn } from '@/shared/utils/cn';
import { buildThumbnailUrl, buildMediaStreamUrl } from '@/shared/utils/fileUrls';
import { formatFileSize } from '@/shared/utils/dateFormatting';
import { useAppDispatch } from '@/app/hooks';
import { openViewerWithFetch } from '@/features/files/store/viewerThunks';
import { AudioBlock } from '@/components/editor/plugins/audio/AudioBlock';
import { VideoBlock } from '@/components/editor/plugins/video/VideoBlock';
import { imageLoadLimiter } from '@/features/chat/utils/imageLoadLimiter';
import type { MessageAttachment } from '@/features/chat/types';

interface MessageAttachmentsProps {
  attachments: MessageAttachment[];
  organizationId: string;
}

function isImage(mime: string): boolean {
  return mime.startsWith('image/');
}

function isAudio(mime: string): boolean {
  return mime.startsWith('audio/');
}

function isVideo(mime: string): boolean {
  return mime.startsWith('video/');
}

interface ChatImageProps {
  src: string;
  alt: string;
  className?: string;
}

function ChatImage({ src, alt, className }: ChatImageProps) {
  const [resolvedSrc, setResolvedSrc] = useState<string | null>(null);
  const releaseRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- src changes require resetting the rendered <img> while we wait for a slot
    setResolvedSrc(null);
    imageLoadLimiter.acquire().then((release) => {
      if (cancelled) {
        release();
        return;
      }
      releaseRef.current = release;
      setResolvedSrc(src);
    });
    return () => {
      cancelled = true;
      if (releaseRef.current) {
        releaseRef.current();
        releaseRef.current = null;
      }
    };
  }, [src]);

  const handleSettled = useCallback(() => {
    if (releaseRef.current) {
      releaseRef.current();
      releaseRef.current = null;
    }
  }, []);

  return (
    <img
      src={resolvedSrc ?? undefined}
      alt={alt}
      className={className}
      loading="lazy"
      onLoad={handleSettled}
      onError={handleSettled}
    />
  );
}

function MessageAttachmentsInner({ attachments, organizationId }: MessageAttachmentsProps) {
  const dispatch = useAppDispatch();

  const handleOpen = useCallback((fileId: string) => {
    dispatch(openViewerWithFetch({ fileId }));
  }, [dispatch]);

  if (attachments.length === 0) return null;

  const images = attachments.filter((a) => isImage(a.mimeType));
  const audios = attachments.filter((a) => isAudio(a.mimeType));
  const videos = attachments.filter((a) => isVideo(a.mimeType));
  const files = attachments.filter((a) => !isImage(a.mimeType) && !isAudio(a.mimeType) && !isVideo(a.mimeType));

  return (
    <div className="mt-1.5 space-y-1.5">
      {images.length > 0 && (
        <div className="grid gap-1.5 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 max-w-lg">
          {images.map((img) => (
            <button
              key={img.id}
              type="button"
              onClick={() => handleOpen(img.fileId)}
              className="block rounded-lg overflow-hidden border border-border hover:border-primary/50 transition-colors cursor-pointer text-left"
            >
              <ChatImage
                src={buildThumbnailUrl(organizationId, img.fileId)}
                alt={img.filename}
                className="w-full h-auto max-h-60 object-cover bg-muted"
              />
            </button>
          ))}
        </div>
      )}

      {audios.map((att) => (
        <div key={att.id} className="relative max-w-md group/media">
          <AudioBlock
            src={buildMediaStreamUrl(organizationId, att.fileId)}
            title={att.filename}
          />
          <button
            type="button"
            onClick={() => handleOpen(att.fileId)}
            title="Open in viewer"
            className={cn(
              'absolute top-1.5 right-1.5 p-1 rounded-md',
              'bg-card/80 backdrop-blur-sm border border-border/50',
              'text-muted-foreground hover:text-foreground',
              'opacity-0 group-hover/media:opacity-100 transition-opacity',
            )}
          >
            <ArrowsOut size={14} />
          </button>
        </div>
      ))}

      {videos.map((att) => (
        <div key={att.id} className="relative max-w-lg rounded-lg overflow-hidden border border-border group/media">
          <VideoBlock
            src={buildMediaStreamUrl(organizationId, att.fileId)}
            title={att.filename}
          />
          <button
            type="button"
            onClick={() => handleOpen(att.fileId)}
            title="Open in viewer"
            className={cn(
              'absolute top-1.5 right-1.5 z-10 p-1 rounded-md',
              'bg-card/80 backdrop-blur-sm border border-border/50',
              'text-muted-foreground hover:text-foreground',
              'opacity-0 group-hover/media:opacity-100 transition-opacity',
            )}
          >
            <ArrowsOut size={14} />
          </button>
        </div>
      ))}

      {files.length > 0 && (
        <div className="flex flex-col gap-1">
          {files.map((file) => (
            <button
              key={file.id}
              type="button"
              onClick={() => handleOpen(file.fileId)}
              className={cn(
                'inline-flex items-center gap-2 px-3 py-2 rounded-lg max-w-xs',
                'bg-muted/30 border border-border hover:border-primary/50',
                'transition-colors group cursor-pointer text-left',
              )}
            >
              <FileArrowDown
                size={18}
                className="shrink-0 text-muted-foreground group-hover:text-primary transition-colors"
              />
              <div className="min-w-0">
                <p className="text-sm text-foreground truncate">{file.filename}</p>
                <p className="text-xs text-muted-foreground">{formatFileSize(file.sizeBytes)}</p>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export const MessageAttachments = memo(MessageAttachmentsInner);
