import { useEffect, useRef, useState } from "react";
import {
  AccessibilityInfo,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import {
  HandPalm,
  ThumbsUp,
  HandsClapping,
  Heart,
  Confetti,
  Smiley,
  ChatCircle,
} from "phosphor-react-native";
import { CallReaction } from "@uniffy/proto/calls/v1/calls_pb";
import { useCall } from "@features/calls/CallContext";
import { useActiveCall, useCallReactions } from "@features/calls/useCallsState";
import { useCallModeration } from "@features/calls/useCallModeration";
import { useCallParticipation } from "@features/calls/useCallParticipation";
import { ControlButton, tick } from "@features/calls/components/ControlButton";
import { CallSheetFeedback } from "@features/calls/components/CallSheetFeedback";
import { Avatar } from "@shared/components/Avatar";
import { BottomSheet } from "@shared/components/BottomSheet";
import { SheetHeader } from "@shared/components/SheetHeader";
import { SheetRow } from "@shared/components/SheetRow";
import { useTheme } from "@shared/hooks/useTheme";
import { FONT } from "@theme/typography";

const reactions = [
  { value: CallReaction.AGREE, label: "Agree", Icon: ThumbsUp },
  { value: CallReaction.APPLAUSE, label: "Applause", Icon: HandsClapping },
  { value: CallReaction.LOVE, label: "Love", Icon: Heart },
  { value: CallReaction.CELEBRATE, label: "Celebrate", Icon: Confetti },
];

export function CallParticipation({
  chatOpen,
  onToggleChat,
}: {
  chatOpen: boolean;
  onToggleChat: () => void;
}) {
  const T = useTheme();
  const { session, room } = useCall();
  const call = useActiveCall(session.channelId ?? undefined);
  const received = useCallReactions();
  const canModerate = useCallModeration(session.callId, call?.hostUserId);
  const { pending, setHand, react } = useCallParticipation();
  const [palette, setPalette] = useState(false);
  const [queue, setQueue] = useState(false);

  const hands = (call?.participants ?? [])
    .filter((p) => p.handRaisedAt)
    .sort(
      (a, b) =>
        a.handRaisedAt!.localeCompare(b.handRaisedAt!) || a.identity.localeCompare(b.identity),
    );
  const handAnnouncement = hands.length
    ? `Hands raised in order: ${hands.map((p) => p.displayName).join(", ")}`
    : "No hands raised";
  // The queue as it stood on arrival is not news; only a change to it is.
  const lastAnnounced = useRef<string | null>(null);
  useEffect(() => {
    if (lastAnnounced.current !== null && lastAnnounced.current !== handAnnouncement)
      AccessibilityInfo.announceForAccessibility(handAnnouncement);
    lastAnnounced.current = handAnnouncement;
  }, [handAnnouncement]);
  const announced = useRef(new Set<string>());
  useEffect(() => {
    for (const r of received) {
      if (r.callId !== session.callId || r.expiresAt <= Date.now() || announced.current.has(r.id))
        continue;
      announced.current.add(r.id);
      AccessibilityInfo.announceForAccessibility(
        `${r.displayName}: ${reactions.find((o) => o.value === r.reaction)?.label ?? "Reaction"}`,
      );
    }
    const ids = new Set(received.map((r) => r.id));
    for (const id of announced.current) if (!ids.has(id)) announced.current.delete(id);
  }, [received, session.callId]);
  const identity = room?.localParticipant.identity;
  const raised = !!call?.participants.find((p) => p.identity === identity)?.handRaisedAt;
  // The bar dims only for a dropped connection: useCallParticipation already
  // drops a tap while a request is in flight, and dimming for that too would
  // flicker the whole row on every press.
  const offline = session.status !== "connected";
  const disabled = pending || offline;

  return (
    <View style={styles.row}>
      <ControlButton
        selected={raised}
        disabled={offline}
        onPress={() => void setHand(!raised)}
        accessibilityLabel={raised ? "Lower hand" : "Raise hand"}
      >
        <HandPalm size={24} color={raised ? T.accent : T.text} weight={raised ? "fill" : "bold"} />
      </ControlButton>
      {hands.length > 0 && (
        <ControlButton
          style={styles.countButton}
          onPress={() => setQueue(true)}
          accessibilityLabel={`${hands.length} raised ${hands.length === 1 ? "hand" : "hands"}`}
          accessibilityHint="Shows the speaking queue"
        >
          <HandPalm size={18} color={T.accent} weight="bold" />
          <Text style={[styles.count, { color: T.accent }]}>{hands.length}</Text>
        </ControlButton>
      )}
      <ControlButton
        disabled={offline}
        onPress={() => setPalette(true)}
        accessibilityLabel="Send a reaction"
      >
        <Smiley size={24} color={T.text} weight="bold" />
      </ControlButton>
      <ControlButton
        selected={chatOpen}
        onPress={onToggleChat}
        accessibilityLabel={chatOpen ? "Close channel chat" : "Channel chat"}
      >
        <ChatCircle
          size={24}
          color={chatOpen ? T.accent : T.text}
          weight={chatOpen ? "fill" : "bold"}
        />
      </ControlButton>
      <BottomSheet visible={palette} onClose={() => setPalette(false)}>
        <SheetHeader title="Reactions" />
        <View style={styles.reactions}>
          {reactions.map(({ value, label, Icon }) => (
            <TouchableOpacity
              key={value}
              style={[styles.reaction, disabled && styles.reactionDisabled]}
              disabled={disabled}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityState={{ disabled }}
              accessibilityLabel={label}
              onPress={() => {
                tick();
                void react(value);
                setPalette(false);
              }}
            >
              <Icon size={28} color={T.accent} weight="duotone" />
              <Text style={[styles.reactionLabel, { color: T.textDim }]}>{label}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </BottomSheet>
      <BottomSheet visible={queue} onClose={() => setQueue(false)}>
        <SheetHeader title={`Raised hands (${hands.length})`} />
        <CallSheetFeedback />
        <ScrollView style={styles.list}>
          {hands.map((p, index) => {
            const canLower = canModerate || p.identity === identity;
            return (
              <SheetRow
                key={p.identity}
                leading={
                  <Avatar name={p.displayName} avatarUrl={p.avatarUrl ?? undefined} size={28} />
                }
                title={p.identity === identity ? `${p.displayName} (you)` : p.displayName}
                subtitle={`#${index + 1} in queue`}
                trailing={
                  canLower ? (
                    <Text style={[styles.lower, { color: disabled ? T.textDim : T.accent }]}>
                      Lower
                    </Text>
                  ) : undefined
                }
                accessibilityHint={canLower ? "Lowers this hand" : undefined}
                onPress={() => {
                  if (canLower && !disabled) void setHand(false, p.identity);
                }}
              />
            );
          })}
          {hands.length === 0 ? (
            <Text style={[styles.empty, { color: T.textDim }]}>No hands raised</Text>
          ) : null}
        </ScrollView>
      </BottomSheet>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 },
  countButton: {
    width: "auto",
    minWidth: 46,
    flexDirection: "row",
    gap: 4,
    paddingHorizontal: 10,
  },
  count: { fontSize: 13, fontFamily: FONT.semibold, fontVariant: ["tabular-nums"] },
  reactions: {
    flexDirection: "row",
    justifyContent: "space-evenly",
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  reaction: {
    minWidth: 64,
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    padding: 8,
  },
  reactionDisabled: { opacity: 0.4 },
  reactionLabel: { fontSize: 12, fontFamily: FONT.medium },
  list: { maxHeight: 280 },
  lower: { fontSize: 13, fontFamily: FONT.semibold },
  empty: { fontSize: 13, fontFamily: FONT.regular, paddingHorizontal: 16, paddingVertical: 14 },
});
