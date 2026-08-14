import { useState } from "react";
import { cn } from "@/shared/utils/cn";
import { getInitials } from "@/components/subject/utils";
import { buildAvatarUrl } from "@/shared/utils/fileUrls";

interface PeerAvatarProps {
  name: string;
  /** Identity gradient from the peer's awareness state, so a face here matches
   *  the same person's `SubjectAvatar` anywhere else in the app. */
  gradient: string;
  userId?: string | null;
  hasAvatar?: boolean;
  /** Tailwind sizing classes for the circle (height + width + text size). */
  sizeClass?: string;
  className?: string;
  title?: string;
}

/** Shared by the presence stack and canvas peer cursors; falls back to initials on image error. */
export function PeerAvatar({
  name,
  gradient,
  userId = null,
  hasAvatar = false,
  sizeClass = "h-5 w-5 text-[10px]",
  className,
  title,
}: PeerAvatarProps) {
  const [imageFailed, setImageFailed] = useState(false);
  const showImage = hasAvatar && userId && !imageFailed;

  return (
    <span
      className={cn(
        "inline-flex select-none items-center justify-center overflow-hidden rounded-full font-medium text-white shadow",
        sizeClass,
        className,
      )}
      style={{ background: gradient }}
      title={title ?? name}
      aria-label={title ?? name}
    >
      {showImage ? (
        <img
          src={buildAvatarUrl(userId as string, "md")}
          alt=""
          className="h-full w-full object-cover"
          onError={() => setImageFailed(true)}
          draggable={false}
        />
      ) : (
        getInitials(name)
      )}
    </span>
  );
}
