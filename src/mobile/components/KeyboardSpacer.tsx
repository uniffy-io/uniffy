import React from "react";
import Animated, { useAnimatedStyle } from "react-native-reanimated";
import { useReanimatedKeyboardAnimation } from "react-native-keyboard-controller";

// Flow spacer that grows to the keyboard height so screen content shrinks
// above the keyboard instead of being covered by it.
export function KeyboardSpacer() {
  const { height } = useReanimatedKeyboardAnimation();
  const style = useAnimatedStyle(() => ({ height: Math.max(0, -height.value) }));
  return <Animated.View style={style} pointerEvents="none" />;
}
