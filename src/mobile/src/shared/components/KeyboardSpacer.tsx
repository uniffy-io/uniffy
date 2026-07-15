import React from "react";
import Animated, { useAnimatedStyle } from "react-native-reanimated";
import { useReanimatedKeyboardAnimation } from "react-native-keyboard-controller";

// Flow spacer reserving minHeight plus the live keyboard height. The bottom
// bar collapses while the keyboard is up, so this reserves the keyboard alone
// and content lands flush on it. KeyboardProvider disables native window
// resizing on Android, so this spacer is the only thing lifting content
// above the keyboard.
export function KeyboardSpacer({ minHeight = 0 }: { minHeight?: number }) {
  const { height } = useReanimatedKeyboardAnimation();
  const style = useAnimatedStyle(() => ({
    height: minHeight + Math.max(0, -height.value),
  }));
  return <Animated.View style={style} pointerEvents="none" />;
}
