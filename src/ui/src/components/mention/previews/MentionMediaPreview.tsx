// Inline-only markup so the card stays HTML-valid as a descendant of `<p>`.
import { VideoCamera } from '@phosphor-icons/react';
import { cn } from '@/shared/utils/cn';

/**
 * The visual half of an expanded mention card. When a thumbnail exists it is
 * the point of the card, so it takes the space and the metadata shrinks to a
 * caption - any content type that grows a thumbnail should render through here
 * rather than sizing its own image block.
 *
 * `object-contain` over a capped height: thumbnails are generated at the
 * source aspect ratio, and cropping a 16:9 render into a fixed box hides the
 * thing the reader opened the card to see.
 */
export function MentionMediaPreview({
  src,
  isVideo = false,
  onError,
  className,
}: {
  src: string;
  isVideo?: boolean;
  onError?: () => void;
  className?: string;
}) {
  return (
    <span className={cn('block relative w-full bg-muted/40 overflow-hidden', className)}>
      <img
        src={src}
        alt=""
        className="block w-full h-auto max-h-80 min-h-24 object-contain"
        onError={onError}
      />
      {isVideo && (
        <span className="flex absolute inset-0 items-center justify-center bg-black/20">
          <VideoCamera size={32} weight="fill" className="text-white/80" />
        </span>
      )}
    </span>
  );
}
