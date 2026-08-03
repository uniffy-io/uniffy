import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { ArrowSquareOut, ChatCircle } from '@phosphor-icons/react';
import { cn } from '@/shared/utils/cn';
import { useAppDispatch, useAppSelector } from '@/app/hooks';
import { usePresence } from '@/features/presence/hooks/usePresence';
import { useAvatarUrl } from '@/shared/hooks/useAvatarUrl';
import { PresenceIndicator } from '@/components/subject';
import { getAvatarGradientStyle, getInitials } from '@/components/subject/utils';
import { createChannel } from '@/features/chat/store/chatThunks';
import { ChannelType } from '@uniffy/proto/chat/v1/chat_pb';
import { fetchPersonThunk } from '@/features/people/store/peopleThunks';

const CARD_WIDTH = 320;
const GAP = 10;

interface PersonHoverCardProps {
    userId: string;
    /** Viewport rect of the hovered node; the card opens beside it. */
    anchor: { top: number; right: number; bottom: number; left: number };
    onMouseEnter: () => void;
    onMouseLeave: () => void;
    onClose: () => void;
}

const PRESENCE_LABELS: Record<string, string> = {
    online: 'Online',
    away: 'Away',
    dnd: 'Do Not Disturb',
    offline: 'Offline',
};

function formatLocalTime(timezone: string): string | null {
    try {
        return new Intl.DateTimeFormat(undefined, {
            hour: '2-digit',
            minute: '2-digit',
            timeZone: timezone,
        }).format(new Date());
    } catch {
        return null;
    }
}

export function PersonHoverCard({
    userId,
    anchor,
    onMouseEnter,
    onMouseLeave,
    onClose,
}: PersonHoverCardProps) {
    const dispatch = useAppDispatch();
    const navigate = useNavigate();
    const person = useAppSelector((s) => s.people.profilesById[userId]);
    const presenceStatus = usePresence(userId);
    const resolvedAvatarUrl = useAvatarUrl(userId, 'md');
    const [imgFailed, setImgFailed] = useState(false);
    const [messagePending, setMessagePending] = useState(false);

    useEffect(() => {
        if (!person) dispatch(fetchPersonThunk({ userId }));
    }, [dispatch, person, userId]);

    const handleMessage = async () => {
        if (messagePending) return;
        setMessagePending(true);
        try {
            const channel = await dispatch(
                createChannel({ name: '', channelType: ChannelType.DIRECT, memberIds: [userId] })
            ).unwrap();
            navigate(`/chat/${channel.id}`);
        } catch {
            setMessagePending(false);
        } finally {
            onClose();
        }
    };

    // Beside the node, clamped to the viewport; flips left when out of room.
    const opensRight = anchor.right + GAP + CARD_WIDTH <= window.innerWidth - 8;
    const left = opensRight
        ? anchor.right + GAP
        : Math.max(8, anchor.left - GAP - CARD_WIDTH);
    const top = Math.max(8, Math.min(anchor.top, window.innerHeight - 320));

    const avatarSrc =
        person && person.hasAvatar && !imgFailed
            ? person.avatarUrl || resolvedAvatarUrl
            : null;
    const localTime = person?.timezone ? formatLocalTime(person.timezone) : null;

    return createPortal(
        <div
            className="fixed z-[9999]"
            style={{ left, top, width: CARD_WIDTH }}
            onMouseEnter={onMouseEnter}
            onMouseLeave={onMouseLeave}
        >
            <div
                className={cn(
                    'rounded-xl border border-border/50 bg-card/95 text-card-foreground shadow-2xl backdrop-blur-xl',
                    'overflow-hidden animate-in fade-in-0 zoom-in-95 duration-150'
                )}
            >
                {!person ? (
                    <div className="flex items-center gap-3 p-4">
                        <div className="h-12 w-12 animate-pulse rounded-xl bg-muted" />
                        <div className="flex-1 space-y-2">
                            <div className="h-4 w-3/4 animate-pulse rounded-md bg-muted" />
                            <div className="h-3 w-1/2 animate-pulse rounded-md bg-muted" />
                        </div>
                    </div>
                ) : (
                    <>
                        <div className="px-4 pb-3 pt-4">
                            <div className="flex items-start gap-3">
                                <div className="relative shrink-0">
                                    {avatarSrc ? (
                                        <img
                                            src={avatarSrc}
                                            alt={person.displayName}
                                            onError={() => setImgFailed(true)}
                                            className="h-12 w-12 rounded-xl object-cover shadow ring-2 ring-background"
                                        />
                                    ) : (
                                        <div
                                            className="flex h-12 w-12 items-center justify-center rounded-xl text-sm font-semibold text-white shadow"
                                            style={getAvatarGradientStyle(
                                                person.displayName || userId
                                            )}
                                        >
                                            {getInitials(person.displayName)}
                                        </div>
                                    )}
                                    <PresenceIndicator status={presenceStatus} size="lg" />
                                </div>
                                <div className="min-w-0 flex-1 pt-0.5">
                                    <div className="flex items-baseline gap-1.5">
                                        <h4 className="truncate text-sm font-semibold">
                                            {person.displayName}
                                        </h4>
                                        {person.pronouns && (
                                            <span className="shrink-0 text-xs text-muted-foreground">
                                                {person.pronouns}
                                            </span>
                                        )}
                                    </div>
                                    {(person.jobTitle || person.department) && (
                                        <p className="truncate text-xs text-muted-foreground">
                                            {[person.jobTitle, person.department]
                                                .filter(Boolean)
                                                .join(' · ')}
                                        </p>
                                    )}
                                    <p className="mt-0.5 text-[11px] font-medium text-muted-foreground">
                                        {PRESENCE_LABELS[presenceStatus] ?? 'Offline'}
                                        {localTime && (
                                            <span className="text-muted-foreground/70">
                                                {' '}· {localTime} local
                                            </span>
                                        )}
                                    </p>
                                </div>
                            </div>

                            {(person.email || person.workPhone || person.officeLocation) && (
                                <div className="mt-3 space-y-1 border-t border-border/50 pt-2.5">
                                    {person.email && (
                                        <p className="truncate text-xs text-muted-foreground">
                                            {person.email}
                                        </p>
                                    )}
                                    {person.workPhone && (
                                        <p className="truncate text-xs text-muted-foreground">
                                            {person.workPhone}
                                        </p>
                                    )}
                                    {person.officeLocation && (
                                        <p className="truncate text-xs text-muted-foreground">
                                            {person.officeLocation}
                                        </p>
                                    )}
                                </div>
                            )}

                            {person.teams.length > 0 && (
                                <div className="mt-2.5 flex flex-wrap gap-1.5">
                                    {person.teams.map((team) => (
                                        <span
                                            key={team.groupId}
                                            className="inline-flex items-center gap-1 rounded-full border border-border bg-muted/40 px-2 py-0.5 text-[10px] font-medium text-foreground"
                                        >
                                            {team.name}
                                            {team.leadUserId === person.userId && (
                                                <span className="text-primary">Lead</span>
                                            )}
                                        </span>
                                    ))}
                                </div>
                            )}

                            {person.bio && (
                                <p className="mt-2.5 line-clamp-2 text-xs text-muted-foreground">
                                    {person.bio}
                                </p>
                            )}
                        </div>

                        <div className="flex items-center gap-2 border-t border-border/50 bg-muted/30 px-4 py-2.5">
                            {!person.isSelf && (
                                <button
                                    type="button"
                                    onClick={() => void handleMessage()}
                                    disabled={messagePending}
                                    className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
                                >
                                    <ChatCircle size={13} weight="fill" />
                                    Message
                                </button>
                            )}
                            <button
                                type="button"
                                onClick={() => {
                                    onClose();
                                    navigate(`/people/${userId}`);
                                }}
                                className="inline-flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
                            >
                                <ArrowSquareOut size={12} />
                                Open profile
                            </button>
                        </div>
                    </>
                )}
            </div>
        </div>,
        document.body
    );
}
