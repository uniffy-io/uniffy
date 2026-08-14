import { useState, useEffect, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import { ChatCircle, ArrowSquareOut } from "@phosphor-icons/react";
import { cn } from "@/shared/utils/cn";
import { useAppSelector } from "@/app/hooks";
import { usePresence } from "@/features/presence/hooks/usePresence";
import { useCustomStatus } from "@/features/presence/hooks/useCustomStatus";
import { useAvatarUrl } from "@/shared/hooks/useAvatarUrl";
import { PresenceIndicator } from "@/components/subject/PresenceIndicator";
import { getAvatarGradientStyle, getInitials } from "@/components/subject/utils";
import { peopleApi } from "@/features/people/api/peopleApi";
import { formatTimeRemaining } from "@/shared/utils/dateFormatting";
import { navigateTo } from "@/shared/utils/navigation";
import { useBreakpoint } from "@/shared/hooks/useBreakpoint";

interface UserHoverCardProps {
  userId: string;
  displayName: string;
  position: { x: number; y: number };
  isVisible: boolean;
  onClose: () => void;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
  onSendMessage?: () => void;
}

interface UserProfileData {
  displayName?: string;
  email?: string;
  username?: string;
  jobTitle?: string;
  department?: string;
  teamNames: string[];
}

const GAP = 8;
const CARD_WIDTH = 288;

export function UserHoverCard({
  userId,
  displayName,
  position,
  isVisible,
  onClose,
  onMouseEnter,
  onMouseLeave,
  onSendMessage,
}: UserHoverCardProps) {
  const { isMobile } = useBreakpoint();
  const organizationId = useAppSelector((s) => s.auth.currentOrganizationId);
  const popoverRef = useRef<HTMLDivElement>(null);
  const [profile, setProfile] = useState<UserProfileData | null>(null);
  const [fetchedUserId, setFetchedUserId] = useState("");

  const presenceStatus = usePresence(userId);
  const customStatus = useCustomStatus(userId);
  const avatarUrl = useAvatarUrl(userId, "md");
  const [avatarFailed, setAvatarFailed] = useState(false);

  useEffect(() => {
    if (!isVisible || !userId || !organizationId || fetchedUserId === userId) return;
    let cancelled = false;

    peopleApi
      .getPerson(organizationId, userId)
      .then((person) => {
        if (cancelled) return;
        setProfile({
          displayName: person.displayName,
          email: person.email,
          username: person.username,
          jobTitle: person.jobTitle,
          department: person.department,
          teamNames: person.teams.map((team) => team.name),
        });
        setFetchedUserId(userId);
      })
      .catch(() => {
        if (!cancelled) setFetchedUserId(userId);
      });

    return () => {
      cancelled = true;
    };
  }, [isVisible, userId, organizationId, fetchedUserId]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    if (isVisible) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [onClose, isVisible]);

  const handleSendMessage = useCallback(() => {
    onSendMessage?.();
    onClose();
  }, [onSendMessage, onClose]);

  const handleOpenProfile = useCallback(() => {
    onClose();
    navigateTo(`/people/${userId}`);
  }, [onClose, userId]);

  const isLoading = isVisible && fetchedUserId !== userId && !profile;

  if (!isVisible || isMobile) return null;

  const adjustedLeft = Math.min(Math.max(position.x, 8), window.innerWidth - CARD_WIDTH - 8);
  const opensDownward = position.y + GAP + 220 <= window.innerHeight;

  const name = profile?.displayName || displayName;
  const roleLine = [profile?.jobTitle, profile?.department].filter(Boolean).join(" · ");
  const subtitle = profile?.email || profile?.username;

  const presenceLabel =
    presenceStatus === "online"
      ? "Online"
      : presenceStatus === "away"
        ? "Away"
        : presenceStatus === "dnd"
          ? "Do Not Disturb"
          : "Offline";

  const presenceColor =
    presenceStatus === "online"
      ? "text-green-600 dark:text-green-400"
      : presenceStatus === "away"
        ? "text-amber-600 dark:text-amber-400"
        : presenceStatus === "dnd"
          ? "text-red-600 dark:text-red-400"
          : "text-muted-foreground";

  return createPortal(
    <div
      ref={popoverRef}
      className="fixed z-[9999]"
      style={{
        left: `${adjustedLeft}px`,
        ...(opensDownward
          ? { top: `${position.y}px`, paddingTop: `${GAP}px` }
          : { bottom: `${window.innerHeight - position.y + GAP}px` }),
      }}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      <div
        className={cn(
          "w-72",
          "bg-card/95 backdrop-blur-xl",
          "text-card-foreground",
          "rounded-xl shadow-2xl",
          "border border-border/50",
          "overflow-hidden",
          "animate-in fade-in-0 zoom-in-95 duration-200",
          opensDownward ? "slide-in-from-top-2" : "slide-in-from-bottom-2",
        )}
      >
        <div className="absolute left-0 top-0 bottom-0 w-[3px] bg-primary" />

        <div className="absolute inset-x-0 top-0 h-16 bg-gradient-to-b from-primary/10 to-transparent pointer-events-none" />

        {isLoading ? (
          <div className="p-4">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-xl bg-muted animate-pulse" />
              <div className="flex-1 space-y-2">
                <div className="h-4 bg-muted rounded-md animate-pulse w-3/4" />
                <div className="h-3 bg-muted rounded-md animate-pulse w-1/2" />
              </div>
            </div>
          </div>
        ) : (
          <>
            <div className="relative px-4 pt-3.5 pb-2 pl-5">
              <div className="flex items-start gap-3">
                <div className="relative shrink-0">
                  {avatarUrl && !avatarFailed ? (
                    <img
                      src={avatarUrl}
                      alt=""
                      onError={() => setAvatarFailed(true)}
                      className="w-12 h-12 rounded-xl object-cover shadow-lg ring-2 ring-background"
                    />
                  ) : (
                    <div
                      className="flex items-center justify-center w-12 h-12 rounded-xl shadow-lg text-white text-sm font-semibold"
                      style={getAvatarGradientStyle(name || userId)}
                    >
                      {getInitials(name)}
                    </div>
                  )}
                  <PresenceIndicator status={presenceStatus} size="lg" />
                </div>

                <div className="flex-1 min-w-0 pt-0.5">
                  <h4 className="font-semibold text-sm truncate">{name}</h4>
                  {roleLine && <p className="text-xs text-muted-foreground truncate">{roleLine}</p>}
                  {subtitle && <p className="text-xs text-muted-foreground truncate">{subtitle}</p>}
                  <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                    <span className={cn("text-xs font-medium", presenceColor)}>
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
                                {" "}
                                {formatTimeRemaining(customStatus.expiresAt)}
                              </span>
                            )}
                          </span>
                        </span>
                      </>
                    )}
                  </div>
                  {profile && profile.teamNames.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mt-1.5">
                      {profile.teamNames.map((teamName) => (
                        <span
                          key={teamName}
                          className="inline-flex items-center rounded-full border border-border bg-muted/40 px-2 py-0.5 text-[10px] font-medium text-foreground"
                        >
                          {teamName}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className="px-4 py-2.5 pl-5 bg-muted/30 border-t border-border/50 flex items-center gap-2">
              {onSendMessage && (
                <button
                  type="button"
                  onClick={handleSendMessage}
                  className={cn(
                    "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium",
                    "bg-primary text-primary-foreground hover:bg-primary/90 transition-colors",
                  )}
                >
                  <ChatCircle size={13} weight="fill" />
                  <span>Message</span>
                </button>
              )}
              <button
                type="button"
                onClick={handleOpenProfile}
                className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                <ArrowSquareOut size={12} />
                <span>Profile</span>
              </button>
            </div>
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}
