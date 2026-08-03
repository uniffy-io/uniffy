import React from "react";
import { StyleSheet, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  interpolate,
  interpolateColor,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from "react-native-reanimated";
import * as Haptics from "expo-haptics";
import { ArrowBendUpLeft } from "phosphor-react-native";
import type { ThemeColors } from "@theme/theme";

const BADGE_SIZE = 34;
const BADGE_GAP = 10;
// Horizontal travel before releasing commits to a reply.
const TRIGGER_DISTANCE = 56;
// Past the trigger the row keeps moving, but heavily damped, so the gesture has
// a floor to land on instead of tracking the finger to the screen edge.
const MAX_DRAG = 78;
const OVERDRAG_RESISTANCE = 0.22;
// The row has to commit to horizontal travel before it steals the drag from the
// transcript's vertical scroll; a vertical lead cancels the pan outright.
const ACTIVATE_DISTANCE = 14;
const VERTICAL_SLOP = 12;
const SPRING = { damping: 22, stiffness: 260, mass: 0.6 };

// The badge rides the avatar gutter, so it lines up with the avatar on a
// message that opens a group and with the single text line on one that
// continues it. Both offsets centre it on that first line; the grouped one is
// negative because the row is shorter than the badge.
const BADGE_TOP_WITH_AVATAR = 11;
const BADGE_TOP_GROUPED = -6;

/**
 * Drag a message to the right to reply to it, the way Messenger and iMessage do
 * it. The badge sits in the avatar gutter and fills in once the drag is past the
 * point where releasing commits.
 */
export function SwipeToReply({
  T,
  enabled = true,
  hasAvatar,
  onReply,
  children,
}: {
  T: ThemeColors;
  enabled?: boolean;
  hasAvatar: boolean;
  onReply: () => void;
  children: React.ReactNode;
}) {
  const offset = useSharedValue(0);
  const armed = useSharedValue(false);

  const signalArmed = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
  };

  const pan = Gesture.Pan()
    .enabled(enabled)
    .activeOffsetX(ACTIVATE_DISTANCE)
    .failOffsetY([-VERTICAL_SLOP, VERTICAL_SLOP])
    .onUpdate((e) => {
      const raw = Math.max(0, e.translationX);
      const damped =
        raw <= TRIGGER_DISTANCE
          ? raw
          : TRIGGER_DISTANCE + (raw - TRIGGER_DISTANCE) * OVERDRAG_RESISTANCE;
      offset.value = Math.min(damped, MAX_DRAG);
      const past = offset.value >= TRIGGER_DISTANCE;
      if (past !== armed.value) {
        armed.value = past;
        // One tick on the way in only - buzzing again on the way out turns a
        // corrective wobble into a stutter.
        if (past) runOnJS(signalArmed)();
      }
    })
    .onEnd(() => {
      if (armed.value) runOnJS(onReply)();
    })
    // Runs after onEnd, and also on interruption (a parent scroll winning the
    // race), so the row can never stay parked open.
    .onFinalize(() => {
      armed.value = false;
      offset.value = withSpring(0, SPRING);
    });

  const rowStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: offset.value }],
  }));

  const badgeStyle = useAnimatedStyle(() => {
    const progress = Math.min(offset.value / TRIGGER_DISTANCE, 1);
    return {
      // Parked off the left edge and pushed in by the drag, so it trails the
      // row instead of sitting under the transparent message body.
      transform: [
        { translateX: offset.value - BADGE_SIZE - BADGE_GAP },
        { scale: interpolate(progress, [0, 1], [0.7, 1]) },
      ],
      opacity: progress,
      backgroundColor: interpolateColor(progress, [0, 1], [T.surface, T.accentSoft]),
      borderColor: interpolateColor(progress, [0, 1], [T.border, T.accent]),
    };
  });

  return (
    <View>
      <Animated.View
        style={[
          styles.badge,
          { marginTop: hasAvatar ? BADGE_TOP_WITH_AVATAR : BADGE_TOP_GROUPED },
          badgeStyle,
        ]}
        pointerEvents="none"
      >
        <ArrowBendUpLeft size={18} color={T.accent} weight="bold" />
      </Animated.View>
      <GestureDetector gesture={pan}>
        <Animated.View style={rowStyle}>{children}</Animated.View>
      </GestureDetector>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    position: "absolute",
    top: 0,
    left: 0,
    width: BADGE_SIZE,
    height: BADGE_SIZE,
    borderRadius: BADGE_SIZE / 2,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: "center",
    justifyContent: "center",
  },
});
