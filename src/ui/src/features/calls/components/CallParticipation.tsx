import { canPublishInCall } from "@/features/calls/utils/callPublishing";
import { useState } from "react";
import { HandPalm, ChatCircle, ArrowDown, Microphone } from "@phosphor-icons/react";
import { useAppDispatch, useAppSelector } from "@/app/hooks";
import { SubjectAvatar } from "@/components/subject/SubjectAvatar";
import { SUBJECT_TYPE } from "@/components/subject/types";
import { cn } from "@/shared/utils/cn";
import { getDeviceId } from "@/shared/utils/deviceId";
import { useCallModeration } from "@/features/calls/hooks/useCallModeration";
import { selectCallSession, selectSessionCall } from "@/features/calls/store/callsSlice";
import {
  setHandRaised,
  sendCallReaction,
  setCallSpeaker,
} from "@/features/calls/store/callsThunks";
import { selectMessagesForChannel } from "@/features/chat/store/chatMessagesSlice";
import { callReactions } from "@/features/calls/utils/callReactions";
import {
  callControlActiveClass,
  callControlClass,
  callMenuItemClass,
} from "@/features/calls/components/controlChrome";

const rowAction =
  "focus-ring flex size-11 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40 md:size-8";

export function CallParticipation({
  onToggleChat,
  chatOpen,
  variant = "menu",
}: {
  onToggleChat?: () => void;
  chatOpen?: boolean;
  variant?: "menu" | "hand";
}) {
  const dispatch = useAppDispatch();
  const call = useAppSelector(selectSessionCall);
  const session = useAppSelector(selectCallSession);
  const [openedAt] = useState(Date.now);
  const latest = useAppSelector((s) =>
    session.channelId ? selectMessagesForChannel(s, session.channelId).at(-1) : undefined,
  );
  const userId = useAppSelector((s) => s.auth.user?.id);
  const canModerate = useCallModeration();
  const [pending, setPending] = useState(false);
  if (!call) return null;
  const ownIdentity = `${userId}:${getDeviceId()}`;
  const own = call.participants.find((p) => p.identity === ownIdentity);
  const hands = call.participants
    .filter((p) => p.handRaisedAt)
    .sort(
      (a, b) =>
        a.handRaisedAt!.localeCompare(b.handRaisedAt!) || a.identity.localeCompare(b.identity),
    );
  const disabled = pending || session.status !== "connected";
  const hand = async (raised: boolean, identity?: string) => {
    setPending(true);
    try {
      await dispatch(setHandRaised({ callId: call.id, raised, identity })).unwrap();
    } catch {
      /* Shared thunk error pipeline reports failures. */
    } finally {
      setPending(false);
    }
  };
  return (
    <div
      className={variant === "menu" ? "space-y-1" : "flex shrink-0 items-center gap-0.5"}
      data-testid="call-participation"
    >
      {!chatOpen && (
        <p role="status" className="sr-only">
          {latest && new Date(latest.createdAt).getTime() > openedAt
            ? `${latest.senderName}: ${latest.isDeleted ? "Message deleted" : latest.content}`
            : ""}
        </p>
      )}
      <button
        type="button"
        className={
          variant === "menu"
            ? cn(
                callMenuItemClass,
                own?.handRaisedAt && "bg-primary/10 text-primary hover:bg-primary/15",
              )
            : cn(callControlClass(), own?.handRaisedAt && callControlActiveClass)
        }
        aria-label={own?.handRaisedAt ? "Lower hand" : "Raise hand"}
        title={own?.handRaisedAt ? "Lower hand" : "Raise hand"}
        aria-pressed={!!own?.handRaisedAt}
        disabled={disabled}
        onClick={() => void hand(!own?.handRaisedAt)}
      >
        <HandPalm
          size={variant === "menu" ? 17 : 16}
          weight={own?.handRaisedAt ? "fill" : "regular"}
        />
        {variant === "menu" && (own?.handRaisedAt ? "Lower hand" : "Raise hand")}
      </button>
      {onToggleChat && variant !== "hand" && (
        <button
          type="button"
          className={cn(
            callMenuItemClass,
            chatOpen && "bg-primary/10 text-primary hover:bg-primary/15",
          )}
          aria-label="Chat"
          title="Channel chat"
          aria-pressed={chatOpen}
          onClick={onToggleChat}
        >
          <ChatCircle size={17} />
          {chatOpen ? "Hide chat" : "Open chat"}
        </button>
      )}
      <div role="status" aria-live="polite" aria-atomic="true" className="sr-only">
        {hands.length
          ? `Hands raised in order: ${hands.map((p) => p.displayName).join(", ")}`
          : "No hands raised"}
      </div>
      {variant === "menu" && (
        <div>
          <p className="px-3 pt-2 text-xs text-muted-foreground">Reactions</p>
          <div role="group" aria-label="Call reactions" className="flex justify-center gap-1 p-1">
            {callReactions.map(({ value, label, Icon }) => (
              <button
                key={value}
                type="button"
                className="focus-ring flex size-11 items-center justify-center rounded-md text-muted-foreground hover:bg-primary/10 hover:text-primary disabled:opacity-40 lg:size-9"
                aria-label={label}
                title={label}
                disabled={disabled}
                onClick={async () => {
                  setPending(true);
                  try {
                    await dispatch(sendCallReaction({ callId: call.id, reaction: value })).unwrap();
                  } catch {
                    /* Shared thunk error pipeline reports failures. */
                  } finally {
                    setPending(false);
                  }
                }}
              >
                <Icon size={22} />
              </button>
            ))}
          </div>
        </div>
      )}
      {variant === "menu" && hands.length > 0 && (
        <div>
          <p className="px-3 py-2 text-xs font-medium text-muted-foreground">
            Raised hands <span className="ml-1 text-subtle-foreground">{hands.length}</span>
          </p>
          <ol aria-label="Raised hands in order" className="max-h-60 overflow-y-auto px-1">
            {hands.map((p, index) => (
              <li
                key={p.identity}
                className="flex items-center gap-2 rounded-md px-2 py-1 hover:bg-muted/50"
              >
                <span className="w-3 text-xs tabular-nums text-subtle-foreground">{index + 1}</span>
                <SubjectAvatar
                  subject={{
                    id: p.userId,
                    type: SUBJECT_TYPE.USER,
                    name: p.displayName,
                    avatarUrl: p.avatarUrl ?? undefined,
                  }}
                  size="xs"
                />
                <span className="min-w-0 flex-1 truncate text-xs">
                  {p.displayName}
                  {p.identity === ownIdentity ? " (you)" : ""}
                </span>
                {call.townHall && canModerate && !canPublishInCall(call, p.userId) && (
                  <button
                    type="button"
                    className={rowAction}
                    disabled={disabled}
                    aria-label={`Allow ${p.displayName} to speak`}
                    title="Allow to speak"
                    onClick={async () => {
                      setPending(true);
                      try {
                        await dispatch(
                          setCallSpeaker({ callId: call.id, userId: p.userId, speaker: true }),
                        ).unwrap();
                      } catch {
                        /* Shared thunk pipeline reports failures. */
                      } finally {
                        setPending(false);
                      }
                    }}
                  >
                    <Microphone size={15} />
                  </button>
                )}
                {(canModerate || p.identity === ownIdentity) && (
                  <button
                    type="button"
                    className={rowAction}
                    disabled={disabled}
                    aria-label={`Lower hand for ${p.displayName}`}
                    title="Lower hand"
                    onClick={() => void hand(false, p.identity)}
                  >
                    <ArrowDown size={15} />
                  </button>
                )}
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}
