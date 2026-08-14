import { useEffect, useState, useCallback } from "react";
import { createPortal } from "react-dom";
import { ArrowSquareOut, ChatCircle, Check, Clock, CopySimple } from "@phosphor-icons/react";
import { getTimezoneOffset } from "date-fns-tz";
import { cn } from "@/shared/utils/cn";
import { useAppDispatch, useAppSelector } from "@/app/hooks";
import { usePresence } from "@/features/presence/hooks/usePresence";
import { useCustomStatus } from "@/features/presence/hooks/useCustomStatus";
import { useAvatarUrl } from "@/shared/hooks/useAvatarUrl";
import { avatarUrlAtVariant } from "@/shared/utils/fileUrls";
import { useBreakpoint } from "@/shared/hooks/useBreakpoint";
import { PresenceIndicator } from "@/components/subject/PresenceIndicator";
import { getAvatarGradientStyle, getInitials } from "@/components/subject/utils";
import { ParentBadge, MetaSeparator } from "@/components/mention/previews/ParentBadge";
import { formatTimeInZone, formatTimeRemaining } from "@/shared/utils/dateFormatting";
import { getEffectiveTimeZone } from "@/shared/utils/timezone";
import { navigateTo } from "@/shared/utils/navigation";
import { createChannel } from "@/features/chat/store/chatThunks";
import { ChannelType } from "@uniffy/proto/chat/v1/chat_pb";
import { fetchPersonThunk } from "@/features/people/store/peopleThunks";
import { useMentionState } from "@/components/mention/useMentionState";

// Same footprint as every other mention preview so the person card reads as one family.
export const PERSON_CARD_WIDTH = 448;
const GAP = 10;
// Flip heuristic only; the card auto-sizes to its content.
const ESTIMATED_HEIGHT = 260;

const PRESENCE_LABELS: Record<string, string> = {
  online: "Online",
  away: "Away",
  dnd: "Do Not Disturb",
  offline: "Offline",
};

const PRESENCE_COLORS: Record<string, string> = {
  online: "text-green-600 dark:text-green-400",
  away: "text-amber-600 dark:text-amber-400",
  dnd: "text-red-600 dark:text-red-400",
  offline: "text-muted-foreground",
};

interface PersonCardContentProps {
  userId: string;
  /** Shown while the profile loads or when the fetch fails (e.g. mention label, sender name). */
  fallbackName?: string;
  /** Overrides the canonical USER urn (mention contexts pass the chip's exact urn). */
  urn?: string;
  onClose: () => void;
  className?: string;
}

/** The card body + chrome, portal-free so hover popovers can embed it. */
export function PersonCardContent({
  userId,
  fallbackName,
  urn,
  onClose,
  className,
}: PersonCardContentProps) {
  const dispatch = useAppDispatch();
  const person = useAppSelector((s) => s.people.profilesById[userId]);
  const fetchStatus = useAppSelector((s) => s.people.profileStatusById[userId]);
  const currentUserId = useAppSelector((s) => s.auth.user?.id);
  const presenceStatus = usePresence(userId);
  const customStatus = useCustomStatus(userId);
  const resolvedAvatarUrl = useAvatarUrl(userId, "lg");
  const [imgFailed, setImgFailed] = useState(false);
  const [messagePending, setMessagePending] = useState(false);
  const [copied, setCopied] = useState(false);

  // The people profile is a point-in-time RPC snapshot; the mention live state
  // (Meili resolve + MENTION_STATE_CHANGED stream) patches renames, role, team,
  // and timezone changes into the open card without a refetch. The key must be
  // the canonical chip form or stream patches land on a different cache entry.
  const mentionUrn = urn ?? `urn:uniffy:content:USER:${userId}`;
  const live = useMentionState(mentionUrn);

  useEffect(() => {
    if (!person && fetchStatus !== "loading") dispatch(fetchPersonThunk({ userId }));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refetch only when the target user changes
  }, [dispatch, userId]);

  const timeZone = live?.userTimezone || person?.timezone || undefined;
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    if (!timeZone) return;
    const id = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(id);
  }, [timeZone]);

  // getTimezoneOffset yields NaN for an unknown zone, so junk from a
  // directory sync degrades to "no time row" instead of a crash.
  const targetOffset = timeZone ? getTimezoneOffset(timeZone, now) : NaN;
  const localTime =
    timeZone &&
    Number.isFinite(targetOffset) &&
    targetOffset !== getTimezoneOffset(getEffectiveTimeZone(), now)
      ? formatTimeInZone(now, timeZone)
      : null;

  const handleMessage = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (messagePending) return;
    setMessagePending(true);
    try {
      const channel = await dispatch(
        createChannel({ name: "", channelType: ChannelType.DIRECT, memberIds: [userId] }),
      ).unwrap();
      navigateTo(`/chat/${channel.id}`);
    } catch {
      setMessagePending(false);
    } finally {
      onClose();
    }
  };

  const handleCopyUrn = useCallback(() => {
    navigator.clipboard.writeText(mentionUrn);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [mentionUrn]);

  const failed = !person && fetchStatus === "failed";
  const name = live?.title || person?.displayName || fallbackName || "Unknown user";
  const firstName = name.trim().split(/\s+/)[0] || name;
  const jobTitle = live?.userJobTitle || person?.jobTitle;
  const department = live?.userDepartment || person?.department;
  const email = live?.userEmail || person?.email;
  const isSelf = userId === currentUserId;

  // The profile payload is a cached snapshot, so its `hasAvatar` may predate an
  // upload the member directory already knows about. Both are tried and `onError`
  // is what settles it, rather than one source vetoing the other.
  const personAvatarUrl = person?.avatarUrl ? avatarUrlAtVariant(person.avatarUrl, "lg") : null;
  const avatarSrc = imgFailed ? null : personAvatarUrl || resolvedAvatarUrl;

  return (
    <div
      className={cn(
        "w-[28rem] max-w-[calc(100vw-1rem)]",
        "bg-card text-card-foreground",
        "rounded-lg shadow-lg border border-border overflow-hidden",
        "animate-in fade-in-0 zoom-in-95 duration-200",
        className,
      )}
    >
      {!person && !live && !failed ? (
        <div className="p-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-muted animate-pulse" />
            <div className="flex-1 space-y-2">
              <div className="h-4 bg-muted rounded-md animate-pulse w-3/4" />
              <div className="h-3 bg-muted rounded-md animate-pulse w-1/2" />
            </div>
          </div>
        </div>
      ) : (
        <>
          <div className="relative px-4 pr-10 pt-3.5 pb-2 pl-5">
            <div className="flex items-start gap-3">
              <div className="relative shrink-0">
                {avatarSrc ? (
                  <img
                    src={avatarSrc}
                    alt={name}
                    onError={() => setImgFailed(true)}
                    className="w-10 h-10 rounded-lg object-cover"
                  />
                ) : (
                  <div
                    className="grid place-items-center w-10 h-10 rounded-lg text-sm font-semibold text-white"
                    style={getAvatarGradientStyle(name)}
                  >
                    {getInitials(name)}
                  </div>
                )}
                <PresenceIndicator status={presenceStatus} />
              </div>

              <div className="flex-1 min-w-0 pt-0.5">
                <div className="flex items-baseline gap-1.5">
                  <span className="font-semibold text-sm truncate">{name}</span>
                  {person?.pronouns && (
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {person.pronouns}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                  <span
                    className={cn(
                      "text-xs font-medium",
                      PRESENCE_COLORS[presenceStatus] ?? "text-muted-foreground",
                    )}
                  >
                    {PRESENCE_LABELS[presenceStatus] ?? "Offline"}
                  </span>
                  {customStatus && (
                    <>
                      <MetaSeparator />
                      <span className="inline-flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
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
                  {(jobTitle || department) && (
                    <>
                      <MetaSeparator />
                      <span className="text-xs text-muted-foreground truncate">
                        {[jobTitle, department].filter(Boolean).join(" · ")}
                      </span>
                    </>
                  )}
                  {!person && live?.userTeamName && (
                    <>
                      <MetaSeparator />
                      <ParentBadge label={live.userTeamName} />
                    </>
                  )}
                  {localTime && (
                    <>
                      <MetaSeparator />
                      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground whitespace-nowrap">
                        <Clock size={11} weight="duotone" />
                        <span>{`It's ${localTime} for ${firstName}`}</span>
                      </span>
                    </>
                  )}
                </div>
              </div>
            </div>
          </div>

          {(email || person?.workPhone || person?.officeLocation) && (
            <div className="flex flex-wrap items-center gap-1.5 px-4 pb-1.5 pl-5 text-xs text-muted-foreground">
              {email && <span className="truncate">{email}</span>}
              {person?.workPhone && (
                <>
                  {email && <MetaSeparator />}
                  <span className="truncate">{person.workPhone}</span>
                </>
              )}
              {person?.officeLocation && (
                <>
                  {(email || person.workPhone) && <MetaSeparator />}
                  <span className="truncate">{person.officeLocation}</span>
                </>
              )}
            </div>
          )}

          {person && person.teams.length > 0 && (
            <div className="flex flex-wrap gap-1.5 px-4 pb-2 pl-5">
              {person.teams.map((team) => (
                <span
                  key={team.groupId}
                  className="inline-flex items-center gap-1 rounded-full border border-border bg-muted/40 px-2 py-0.5 text-[10px] font-medium text-foreground"
                >
                  {team.name}
                  {team.leadUserId === person.userId && <span className="text-primary">Lead</span>}
                </span>
              ))}
            </div>
          )}

          {person?.bio && (
            <div className="px-4 pb-2.5 pl-5">
              <p className="text-xs text-muted-foreground leading-relaxed line-clamp-2">
                {person.bio}
              </p>
            </div>
          )}

          {!failed && (
            <div className="flex px-4 py-2.5 pl-5 bg-muted/30 border-t border-border/50 items-center gap-3">
              {!isSelf && (
                <button
                  type="button"
                  onClick={(e) => void handleMessage(e)}
                  disabled={messagePending}
                  className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
                >
                  <ChatCircle size={12} />
                  <span>Message</span>
                </button>
              )}
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onClose();
                  navigateTo(`/people/${userId}`);
                }}
                className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                <ArrowSquareOut size={12} />
                <span>Open profile</span>
              </button>
              <span className="flex-1" />
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  handleCopyUrn();
                }}
                className="p-1 rounded-md hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
                title="Copy URN"
              >
                {copied ? (
                  <Check size={12} weight="bold" className="text-green-500" />
                ) : (
                  <CopySimple size={12} weight="bold" />
                )}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

interface PersonHoverCardProps {
  userId: string;
  fallbackName?: string;
  urn?: string;
  /** Viewport rect of the hovered element; the card opens off it per `placement`. */
  anchor: { top: number; right: number; bottom: number; left: number };
  /** `below` drops under the anchor (flips up near the bottom edge); `beside` opens to the right (flips left). */
  placement?: "below" | "beside";
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
  onClose: () => void;
}

/** Portal wrapper positioning the person card next to a hovered anchor. */
export function PersonHoverCard({
  userId,
  fallbackName,
  urn,
  anchor,
  placement = "below",
  onMouseEnter,
  onMouseLeave,
  onClose,
}: PersonHoverCardProps) {
  const { isMobile } = useBreakpoint();
  if (isMobile) return null;

  let style: React.CSSProperties;
  let slideClass: string;

  if (placement === "beside") {
    const opensRight = anchor.right + GAP + PERSON_CARD_WIDTH <= window.innerWidth - 8;
    const left = opensRight
      ? anchor.right + GAP
      : Math.max(8, anchor.left - GAP - PERSON_CARD_WIDTH);
    const top = Math.max(8, Math.min(anchor.top, window.innerHeight - ESTIMATED_HEIGHT - 8));
    style = { left, top };
    slideClass = opensRight ? "slide-in-from-left-2" : "slide-in-from-right-2";
  } else {
    const left = Math.max(8, Math.min(anchor.left, window.innerWidth - PERSON_CARD_WIDTH - 8));
    const opensDownward = anchor.bottom + GAP + ESTIMATED_HEIGHT <= window.innerHeight;
    // The padding keeps the gap between anchor and card hoverable so the card stays open.
    style = opensDownward
      ? { left, top: anchor.bottom, paddingTop: GAP }
      : { left, bottom: window.innerHeight - anchor.top, paddingBottom: GAP };
    slideClass = opensDownward ? "slide-in-from-top-2" : "slide-in-from-bottom-2";
  }

  return createPortal(
    <div
      className="fixed z-[9999]"
      style={style}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      <PersonCardContent
        userId={userId}
        fallbackName={fallbackName}
        urn={urn}
        onClose={onClose}
        className={slideClass}
      />
    </div>,
    document.body,
  );
}
