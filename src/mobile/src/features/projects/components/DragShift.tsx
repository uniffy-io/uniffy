import React, { useEffect } from "react";
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import type { LayoutChangeEvent, StyleProp, ViewStyle } from "react-native";

const SHIFT_MS = 160;

/**
 * Slides content aside to open or close a gap during a drag.
 *
 * The shift is a transform, so it never changes layout: the measurements the
 * drag hit-tests against stay valid while the cards move. Once the drag ends
 * the list re-renders in its new order, so the offset snaps back rather than
 * animating - easing it would play the move twice.
 */
export function DragShift({
  offset,
  animate,
  style,
  onLayout,
  children,
}: {
  offset: number;
  animate: boolean;
  style?: StyleProp<ViewStyle>;
  /**
   * Measured here rather than on a child: this view is the one the surrounding
   * layout positions, so it is the one whose offset the drag can trust.
   */
  onLayout?: (event: LayoutChangeEvent) => void;
  children: React.ReactNode;
}) {
  const shift = useSharedValue(0);

  useEffect(() => {
    shift.value = animate ? withTiming(offset, { duration: SHIFT_MS }) : 0;
  }, [animate, offset, shift]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: shift.value }],
  }));

  return (
    <Animated.View style={[style, animatedStyle]} onLayout={onLayout}>
      {children}
    </Animated.View>
  );
}
