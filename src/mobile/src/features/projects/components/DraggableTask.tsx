import React, { useEffect } from "react";
import { GestureDetector } from "react-native-gesture-handler";
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import type { LayoutChangeEvent } from "react-native";
import type { GestureType } from "react-native-gesture-handler";

const SHIFT_MS = 160;

/**
 * A task card that can be picked up, and that slides aside when another card is
 * dragged past it. The lifted card itself goes invisible rather than being
 * unmounted: it keeps its slot, so the cards around it shift over a layout that
 * does not move under the finger.
 */
export function DraggableTask({
  gesture,
  offset,
  animate,
  lifted,
  onLayout,
  children,
}: {
  gesture: GestureType;
  offset: number;
  animate: boolean;
  lifted: boolean;
  onLayout: (event: LayoutChangeEvent) => void;
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
    <GestureDetector gesture={gesture}>
      <Animated.View onLayout={onLayout} style={[animatedStyle, lifted && { opacity: 0 }]}>
        {children}
      </Animated.View>
    </GestureDetector>
  );
}
