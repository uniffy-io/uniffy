import { useEffect, useState } from "react";
import { View, Text, StyleSheet } from "react-native";
import { ThumbsUp, HandsClapping, Heart, Confetti } from "phosphor-react-native";
import { CallReaction } from "@uniffy/proto/calls/v1/calls_pb";
import { useCall } from "@features/calls/CallContext";
import { useCallReactions } from "@features/calls/useCallsState";
import { useTheme } from "@shared/hooks/useTheme";
import { FONT } from "@theme/typography";

const icons = {
  [CallReaction.AGREE]: ThumbsUp,
  [CallReaction.APPLAUSE]: HandsClapping,
  [CallReaction.LOVE]: Heart,
  [CallReaction.CELEBRATE]: Confetti,
};

// Positioned against the call stage it is rendered in, so it rides over the
// video and never over the controls or the chat input below it.
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
    <View pointerEvents="none" style={styles.overlay}>
      {received
        .filter((r) => r.callId === session.callId && r.expiresAt > now)
        .slice(-3)
        .map((r) => {
          const Icon = icons[r.reaction as keyof typeof icons];
          if (!Icon) return null;
          return (
            <View
              key={r.id}
              style={[styles.pill, { backgroundColor: T.surface, borderColor: T.border }]}
            >
              <Icon size={16} color={T.accent} weight="fill" />
              <Text style={[styles.name, { color: T.text }]} numberOfLines={1}>
                {r.displayName}
              </Text>
            </View>
          );
        })}
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    position: "absolute",
    left: 18,
    right: 18,
    bottom: 8,
    gap: 6,
    alignItems: "flex-start",
  },
  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    maxWidth: "100%",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
  },
  name: { flexShrink: 1, fontSize: 12, fontFamily: FONT.medium },
});
