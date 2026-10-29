import { BottomSheet } from "@shared/components/BottomSheet";
import { SheetHeader } from "@shared/components/SheetHeader";
import { useEffect, useRef, useState } from "react";
import { AccessibilityInfo, Pressable, ScrollView, Text, View } from "react-native";
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
import { useTheme } from "@shared/hooks/useTheme";

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
  const announced = useRef(new Set<string>());
  useEffect(() => {
    AccessibilityInfo.announceForAccessibility(handAnnouncement);
  }, [handAnnouncement]);
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
  const disabled = pending || session.status !== "connected";
  const button = {
    minHeight: 44,
    minWidth: 44,
    alignItems: "center" as const,
    justifyContent: "center" as const,
    borderRadius: 10,
  };
  return (
    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6 }}>
      <Pressable
        style={[button, raised && { backgroundColor: T.surface }]}
        disabled={disabled}
        accessibilityRole="button"
        accessibilityLabel={raised ? "Lower hand" : "Raise hand"}
        accessibilityState={{ selected: raised, disabled }}
        onPress={() => void setHand(!raised)}
      >
        <HandPalm
          color={raised ? T.accent : T.textDim}
          size={20}
          weight={raised ? "fill" : "regular"}
        />
      </Pressable>
      {hands.length > 0 && (
        <Pressable
          style={button}
          accessibilityRole="button"
          accessibilityLabel={`${hands.length} waiting`}
          onPress={() => setQueue(true)}
        >
          <Text style={{ color: T.accent, fontSize: 12 }}>{hands.length}</Text>
        </Pressable>
      )}
      <Pressable
        style={button}
        accessibilityRole="button"
        accessibilityLabel="React"
        onPress={() => setPalette(true)}
      >
        <Smiley size={20} color={T.textDim} />
      </Pressable>
      <Pressable
        style={button}
        accessibilityRole="button"
        accessibilityLabel="Channel chat"
        accessibilityState={{ selected: chatOpen }}
        onPress={onToggleChat}
      >
        <ChatCircle size={20} color={chatOpen ? T.accent : T.textDim} />
      </Pressable>
      <BottomSheet visible={palette} onClose={() => setPalette(false)}>
        <SheetHeader title="Reactions" />
        <View style={{ flexDirection: "row", justifyContent: "space-evenly", padding: 12 }}>
          {reactions.map(({ value, label, Icon }) => (
            <Pressable
              key={value}
              style={[button, { gap: 6, padding: 8 }]}
              disabled={disabled}
              accessibilityRole="button"
              accessibilityLabel={label}
              onPress={() => {
                void react(value);
                setPalette(false);
              }}
            >
              <Icon size={24} color={T.textDim} />
              <Text style={{ color: T.textDim, fontSize: 12 }}>{label}</Text>
            </Pressable>
          ))}
        </View>
      </BottomSheet>
      <BottomSheet visible={queue} onClose={() => setQueue(false)}>
        <SheetHeader title={`Raised hands (${hands.length})`} />
        <ScrollView style={{ maxHeight: 280 }}>
          {hands.map((p, index) => (
            <View
              key={p.identity}
              style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: 16, gap: 10 }}
            >
              <Text style={{ color: T.textDim, fontSize: 12 }}>{index + 1}</Text>
              <Text style={{ color: T.text, flex: 1, fontSize: 14 }}>{p.displayName}</Text>
              {(canModerate || p.identity === identity) && (
                <Pressable
                  style={button}
                  disabled={disabled}
                  accessibilityRole="button"
                  accessibilityLabel={`Lower hand for ${p.displayName}`}
                  onPress={() => void setHand(false, p.identity)}
                >
                  <Text style={{ color: T.textDim, fontSize: 12 }}>Lower</Text>
                </Pressable>
              )}
            </View>
          ))}
        </ScrollView>
      </BottomSheet>
    </View>
  );
}
