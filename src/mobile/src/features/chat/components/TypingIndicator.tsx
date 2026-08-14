import React, { useEffect } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from "react-native-reanimated";
import { Stop } from "phosphor-react-native";
import { useTheme } from "@shared/hooks/useTheme";
import { FONT } from "@theme/typography";

const BAR_COUNT = 4;
const BAR_STAGGER_MS = 130;
const WAVE_HALF_MS = 550;

function Bar({ index, color }: { index: number; color: string }) {
  const reducedMotion = useReducedMotion();
  const phase = useSharedValue(0.5);

  useEffect(() => {
    if (reducedMotion) return;
    // A shared value is a mutable UI-thread box; assigning `.value` is the only
    // way to drive it, and it is deliberately outside React's render state.
    // eslint-disable-next-line react/react-compiler
    phase.value = 0;
    phase.value = withDelay(
      index * BAR_STAGGER_MS,
      withRepeat(
        withSequence(
          withTiming(1, { duration: WAVE_HALF_MS, easing: Easing.inOut(Easing.ease) }),
          withTiming(0, { duration: WAVE_HALF_MS, easing: Easing.inOut(Easing.ease) }),
        ),
        -1,
      ),
    );
    return () => cancelAnimation(phase);
  }, [index, phase, reducedMotion]);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: 0.55 + phase.value * 0.45,
    transform: [{ scaleY: 0.35 + phase.value * 0.65 }],
  }));

  return <Animated.View style={[styles.bar, { backgroundColor: color }, animatedStyle]} />;
}

/** Equalizer-style "thinking" wave, matching the web chat indicator. */
export function TypingWave({ color }: { color: string }) {
  return (
    <View style={styles.wave} accessibilityElementsHidden>
      {Array.from({ length: BAR_COUNT }, (_, i) => (
        <Bar key={i} index={i} color={color} />
      ))}
    </View>
  );
}

export type TypingHuman = { id: string; name: string };

type TypingIndicatorProps = {
  agentIds: string[];
  humans: TypingHuman[];
  onStopAgents: (agentIds: string[]) => void;
};

function typingText(names: string[]): string {
  if (names.length === 1) return `${names[0]} is typing`;
  if (names.length === 2) return `${names[0]} and ${names[1]} are typing`;
  return "Several people are typing";
}

// Agents get a bare wave plus a compact Stop control pinned above the
// composer; humans get an understated name row with the same wave.
export function TypingIndicator({ agentIds, humans, onStopAgents }: TypingIndicatorProps) {
  const T = useTheme();

  if (agentIds.length === 0 && humans.length === 0) return null;

  return (
    <View style={styles.row}>
      {agentIds.length > 0 ? (
        <>
          <TypingWave color={T.accent} />
          <Pressable
            onPress={() => onStopAgents(agentIds)}
            hitSlop={10}
            style={({ pressed }) => [
              styles.stopPill,
              {
                backgroundColor: pressed ? `${T.red}26` : T.surface,
                borderColor: T.border,
              },
            ]}
            accessibilityRole="button"
            accessibilityLabel="Stop the agent"
          >
            <Stop size={11} color={T.textDim} weight="fill" />
            <Text style={[styles.stopLabel, { color: T.textDim }]}>Stop</Text>
          </Pressable>
        </>
      ) : (
        <>
          <Text numberOfLines={1} style={[styles.typingLabel, { color: T.textDim }]}>
            {typingText(humans.map((h) => h.name))}
          </Text>
          <TypingWave color={T.accent} />
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 16,
    minHeight: 26,
    marginBottom: 4,
  },
  wave: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    height: 12,
  },
  bar: {
    width: 3,
    height: 12,
    borderRadius: 2,
  },
  stopPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    height: 24,
    borderRadius: 12,
    paddingLeft: 7,
    paddingRight: 9,
    borderWidth: StyleSheet.hairlineWidth,
  },
  stopLabel: {
    fontSize: 11,
    fontFamily: FONT.medium,
  },
  typingLabel: {
    fontSize: 12,
    fontFamily: FONT.regular,
    flexShrink: 1,
  },
});
