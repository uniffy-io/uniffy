import React, { useEffect, useRef } from "react";
import { StyleSheet } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from "react-native-reanimated";

const MARGIN = 12;
const SPRING = { damping: 20, stiffness: 220 };

// A floating self-view tile the user can drag around the call stage. It stays
// within the container bounds and snaps to the nearest horizontal edge on
// release, matching the picture-in-picture behavior of Messenger/Teams.
export function DraggablePip({
  containerWidth,
  containerHeight,
  width,
  height,
  children,
}: {
  containerWidth: number;
  containerHeight: number;
  width: number;
  height: number;
  children: React.ReactNode;
}) {
  const maxX = Math.max(MARGIN, containerWidth - width - MARGIN);
  const maxY = Math.max(MARGIN, containerHeight - height - MARGIN);
  const x = useSharedValue(MARGIN);
  const y = useSharedValue(MARGIN);
  const startX = useSharedValue(0);
  const startY = useSharedValue(0);
  const placed = useRef(false);

  // Park in the top-right corner once the stage has a real measured size; on a
  // later size change (rotation) keep the tile inside the new bounds.
  useEffect(() => {
    if (containerWidth <= 0 || containerHeight <= 0) return;
    if (!placed.current) {
      placed.current = true;
      x.value = maxX;
      y.value = MARGIN;
      return;
    }
    x.value = withSpring(Math.min(x.value, maxX), SPRING);
    y.value = withSpring(Math.min(y.value, maxY), SPRING);
  }, [containerWidth, containerHeight, maxX, maxY, x, y]);

  const pan = Gesture.Pan()
    .onStart(() => {
      startX.value = x.value;
      startY.value = y.value;
    })
    .onUpdate((e) => {
      x.value = Math.min(Math.max(MARGIN, startX.value + e.translationX), maxX);
      y.value = Math.min(Math.max(MARGIN, startY.value + e.translationY), maxY);
    })
    .onEnd(() => {
      const atRight = x.value + width / 2 > containerWidth / 2;
      x.value = withSpring(atRight ? maxX : MARGIN, SPRING);
    });

  const style = useAnimatedStyle(() => ({
    transform: [{ translateX: x.value }, { translateY: y.value }],
  }));

  return (
    <GestureDetector gesture={pan}>
      <Animated.View style={[styles.pip, { width, height }, style]}>{children}</Animated.View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  pip: {
    position: "absolute",
    top: 0,
    left: 0,
    borderRadius: 14,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.35,
    shadowRadius: 8,
    elevation: 8,
  },
});
