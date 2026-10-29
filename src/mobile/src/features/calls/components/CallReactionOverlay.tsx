import { useEffect, useState } from "react";
import { View, Text } from "react-native";
import { ThumbsUp, HandsClapping, Heart, Confetti } from "phosphor-react-native";
import { CallReaction } from "@uniffy/proto/calls/v1/calls_pb";
import { useCall } from "@features/calls/CallContext";
import { useCallReactions } from "@features/calls/useCallsState";
import { useTheme } from "@shared/hooks/useTheme";
const icons = {
  [CallReaction.AGREE]: ThumbsUp,
  [CallReaction.APPLAUSE]: HandsClapping,
  [CallReaction.LOVE]: Heart,
  [CallReaction.CELEBRATE]: Confetti,
};
export function CallReactionOverlay() {
  const T = useTheme();
  const { session } = useCall();
  const received = useCallReactions();
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(timer);
  }, []);
  return (
    <View
      pointerEvents="none"
      style={{
        position: "absolute",
        bottom: 160,
        left: 18,
        right: 18,
        gap: 6,
        alignItems: "flex-start",
      }}
    >
      {received
        .filter((r) => r.callId === session.callId && r.expiresAt > now)
        .slice(-3)
        .map((r) => {
          const Icon = icons[r.reaction as keyof typeof icons];
          if (!Icon) return null;
          return (
            <View
              key={r.id}
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: 8,
                borderRadius: 10,
                paddingVertical: 6,
                paddingHorizontal: 10,
                backgroundColor: T.surface,
              }}
            >
              <Icon size={18} color={T.accent} />
              <Text style={{ color: T.text, fontSize: 12 }}>{r.displayName}</Text>
            </View>
          );
        })}
    </View>
  );
}
