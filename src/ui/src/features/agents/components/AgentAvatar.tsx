import { useState } from "react";
import { Robot } from "@phosphor-icons/react";
import { cn } from "@/shared/utils/cn";
import { getAgentAvatarGradientStyle, getInitials } from "@/components/subject/utils";

type AvatarSize = "xs" | "sm" | "md" | "lg" | "xl";

// Matches the SubjectAvatar scale so agent and user avatars sit at the
// same size in shared lists (sidebar, pickers, member rows).
const SIZE_CLASSES: Record<AvatarSize, string> = {
  xs: "w-5 h-5 text-[9px]",
  sm: "w-6 h-6 text-[10px]",
  md: "w-8 h-8 text-xs",
  lg: "w-10 h-10 text-sm",
  xl: "w-12 h-12 text-base",
};

const ICON_SIZES: Record<AvatarSize, number> = {
  xs: 10,
  sm: 12,
  md: 16,
  lg: 20,
  xl: 24,
};

interface AgentAvatarProps {
  avatarKey?: string;
  avatarEmoji?: string;
  agentName: string;
  size?: AvatarSize;
  className?: string;
}

export function AgentAvatar({
  avatarKey,
  avatarEmoji,
  agentName,
  size = "md",
  className,
}: AgentAvatarProps) {
  const [imgError, setImgError] = useState(false);

  const hasImage = !!(avatarKey && !imgError);
  const sizeClass = SIZE_CLASSES[size];

  if (hasImage) {
    return (
      <img
        src={avatarKey}
        alt={agentName}
        onError={() => setImgError(true)}
        className={cn("rounded-full object-cover shrink-0", sizeClass, className)}
        data-testid="agent-avatar"
        data-agent-name={agentName}
        data-fallback="image"
      />
    );
  }

  const fallback = avatarEmoji || null;

  // Same identity treatment as user avatars: deterministic gradient keyed
  // by name (see components/subject/utils.ts), initials on top. A span, not
  // a div, so the avatar stays valid HTML inside paragraph-hosted previews.
  return (
    <span
      className={cn(
        "rounded-full flex items-center justify-center font-medium text-white shrink-0",
        sizeClass,
        className,
      )}
      style={getAgentAvatarGradientStyle(agentName)}
      data-testid="agent-avatar"
      data-agent-name={agentName}
      data-fallback={fallback ? "emoji" : "initial"}
    >
      {fallback || (agentName ? getInitials(agentName) : <Robot size={ICON_SIZES[size]} />)}
    </span>
  );
}
