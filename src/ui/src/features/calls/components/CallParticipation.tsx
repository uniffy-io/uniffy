import { canPublishInCall } from "@/features/calls/utils/callPublishing";
import { useRef, useState } from "react";
import {
  HandPalm,
  Smiley,
  ChatCircle,
  CaretDown,
  ArrowDown,
  Microphone,
} from "@phosphor-icons/react";
import { useAppDispatch, useAppSelector } from "@/app/hooks";
import { PortalMenu } from "@/components/ui/portal-menu";
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

const control =
  "focus-ring flex size-11 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40 md:size-9";

export function CallParticipation({
  onToggleChat,
  chatOpen,
}: {
  onToggleChat?: () => void;
  chatOpen?: boolean;
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
  const [menu, setMenu] = useState<"reactions" | "hands" | null>(null);
  const reactionRef = useRef<HTMLButtonElement>(null);
  const handsRef = useRef<HTMLButtonElement>(null);
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
  const closeMenu = () => {
    (menu === "reactions" ? reactionRef : handsRef).current?.focus();
    setMenu(null);
  };
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
    <div className="flex shrink-0 items-center gap-0.5" data-testid="call-participation">
      {!chatOpen && (
        <p role="status" className="sr-only">
          {latest && new Date(latest.createdAt).getTime() > openedAt
            ? `${latest.senderName}: ${latest.isDeleted ? "Message deleted" : latest.content}`
            : ""}
        </p>
      )}
      <button
        type="button"
        className={cn(control, own?.handRaisedAt && "bg-primary/10 text-primary")}
        aria-label={own?.handRaisedAt ? "Lower hand" : "Raise hand"}
        title={own?.handRaisedAt ? "Lower hand" : "Raise hand"}
        aria-pressed={!!own?.handRaisedAt}
        disabled={disabled}
        onClick={() => void hand(!own?.handRaisedAt)}
      >
        <HandPalm size={17} weight={own?.handRaisedAt ? "fill" : "regular"} />
      </button>
      {hands.length > 0 && (
        <button
          ref={handsRef}
          type="button"
          className="focus-ring flex h-11 items-center gap-1 rounded-md px-1.5 text-xs tabular-nums text-primary hover:bg-primary/10 md:h-9"
          aria-label={`${hands.length} waiting`}
          title="Raised hands"
          aria-expanded={menu === "hands"}
          onClick={() => setMenu(menu === "hands" ? null : "hands")}
        >
          {hands.length}
          <CaretDown size={10} />
        </button>
      )}
      <button
        ref={reactionRef}
        type="button"
        className={cn(control, menu === "reactions" && "bg-muted text-foreground")}
        aria-label="React"
        title="React"
        aria-expanded={menu === "reactions"}
        onClick={() => setMenu(menu === "reactions" ? null : "reactions")}
      >
        <Smiley size={17} />
      </button>
      {onToggleChat && (
        <button
          type="button"
          className={cn(control, chatOpen && "bg-primary/10 text-primary")}
          aria-label="Chat"
          title="Channel chat"
          aria-pressed={chatOpen}
          onClick={onToggleChat}
        >
          <ChatCircle size={17} />
        </button>
      )}
      <div role="status" aria-live="polite" aria-atomic="true" className="sr-only">
        {hands.length
          ? `Hands raised in order: ${hands.map((p) => p.displayName).join(", ")}`
          : "No hands raised"}
      </div>
      <PortalMenu
        autoFocus
        open={menu === "reactions"}
        onClose={closeMenu}
        triggerRef={reactionRef}
        className="w-52"
      >
        <div role="group" aria-label="Call reactions" className="flex justify-center gap-1 p-1">
          {callReactions.map(({ value, label, Icon }) => (
            <button
              key={value}
              type="button"
              className="focus-ring flex size-11 items-center justify-center rounded-md text-muted-foreground hover:bg-primary/10 hover:text-primary disabled:opacity-40"
              aria-label={label}
              title={label}
              disabled={disabled}
              onClick={async () => {
                setPending(true);
                try {
                  await dispatch(sendCallReaction({ callId: call.id, reaction: value })).unwrap();
                  closeMenu();
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
      </PortalMenu>
      <PortalMenu
        autoFocus
        open={menu === "hands"}
        onClose={closeMenu}
        triggerRef={handsRef}
        className="w-64"
      >
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
                  className={control}
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
                  className={cn(control, "size-11 md:size-8")}
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
        {hands.length === 0 && (
          <p className="px-3 py-2 text-xs text-muted-foreground">No hands raised</p>
        )}
      </PortalMenu>
    </div>
  );
}
