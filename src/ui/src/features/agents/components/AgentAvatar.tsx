/**
 * AgentAvatar - Displays an agent's avatar with image/emoji/initials fallback.
 *
 * Priority: uploaded image > emoji > first character of name.
 * The avatarKey prop is a full URL path returned by the backend
 * (e.g. /api/agents/avatars/{agentId}/lg?v={hash}).
 */

import { useState } from "react";
import { Robot } from "@phosphor-icons/react";
import { cn } from "@/shared/utils/cn";

type AvatarSize = "xs" | "sm" | "md" | "lg" | "xl";

const SIZE_CLASSES: Record<AvatarSize, string> = {
    xs: "w-5 h-5 text-[10px]",
    sm: "w-7 h-7 text-sm",
    md: "w-8 h-8 text-sm",
    lg: "w-10 h-10 text-base",
    xl: "w-12 h-12 text-lg",
};

const ICON_SIZES: Record<AvatarSize, number> = {
    xs: 10,
    sm: 14,
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
                className={cn(
                    "rounded-full object-cover shrink-0",
                    sizeClass,
                    className,
                )}
                data-testid="agent-avatar"
                data-agent-name={agentName}
                data-fallback="image"
            />
        );
    }

    const fallback = avatarEmoji || null;

    return (
        <div
            className={cn(
                "rounded-full bg-muted flex items-center justify-center font-medium text-foreground shrink-0",
                sizeClass,
                className,
            )}
            data-testid="agent-avatar"
            data-agent-name={agentName}
            data-fallback={fallback ? "emoji" : "initial"}
        >
            {fallback || (
                agentName
                    ? agentName.charAt(0)
                    : <Robot size={ICON_SIZES[size]} className="text-muted-foreground" />
            )}
        </div>
    );
}
