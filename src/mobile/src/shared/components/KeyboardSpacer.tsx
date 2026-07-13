import React from "react";
import Animated, { useAnimatedStyle } from "react-native-reanimated";
import { useReanimatedKeyboardAnimation } from "react-native-keyboard-controller";

// Flow spacer reserving max(minHeight, keyboardHeight): the bottom bar's
// space while the keyboard is closed, the keyboard's height while it is
// open, so inputs sit flush above whichever occupies the bottom edge.
// KeyboardProvider disables native window resizing on Android, so this
// spacer is the only thing lifting content above the keyboard.
export function KeyboardSpacer({ minHeight = 0 }: { minHeight?: number }) {
  const { height } = useReanimatedKeyboardAnimation();
  const style = useAnimatedStyle(() => ({ height: Math.max(minHeight, -height.value) }));
  return <Animated.View style={style} pointerEvents="none" />;
}
