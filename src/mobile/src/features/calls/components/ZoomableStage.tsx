import React, { useEffect } from "react";
import { StyleSheet, type StyleProp, type ViewStyle } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";

const ZOOM_MIN = 1;
const ZOOM_MAX = 8;
const DOUBLE_TAP_SCALE = 2.5;

function clamp(value: number, min: number, max: number): number {
  "worklet";
  return Math.min(Math.max(value, min), max);
}

/**
 * A shared desktop letterboxed into a phone tile is unreadable at fit, so the
 * stage zooms. Pan is clamped to the scaled content plus a quarter frame of
 * slack, matching the web tile, so the content can never be flung out of view.
 */
export function ZoomableStage({
  /** Resets to fit when the underlying track changes. */
  trackKey,
  style,
  children,
}: {
  trackKey: string;
  /** Needed wherever the parent centers its children, which collapses a flex child. */
  style?: StyleProp<ViewStyle>;
  children: React.ReactNode;
}) {
  const scale = useSharedValue(1);
  const savedScale = useSharedValue(1);
  const tx = useSharedValue(0);
  const ty = useSharedValue(0);
  const savedTx = useSharedValue(0);
  const savedTy = useSharedValue(0);
  const width = useSharedValue(0);
  const height = useSharedValue(0);

  useEffect(() => {
    scale.value = withTiming(1);
    savedScale.value = 1;
    tx.value = withTiming(0);
    ty.value = withTiming(0);
    savedTx.value = 0;
    savedTy.value = 0;
  }, [trackKey, scale, savedScale, tx, ty, savedTx, savedTy]);

  const pinch = Gesture.Pinch()
    .onUpdate((e) => {
      scale.value = clamp(savedScale.value * e.scale, ZOOM_MIN, ZOOM_MAX);
    })
    .onEnd(() => {
      savedScale.value = scale.value;
      if (scale.value <= ZOOM_MIN) {
        tx.value = withTiming(0);
        ty.value = withTiming(0);
        savedTx.value = 0;
        savedTy.value = 0;
      }
    });

  const pan = Gesture.Pan()
    .onUpdate((e) => {
      if (scale.value <= ZOOM_MIN) return;
      const maxX = (width.value * (scale.value - 1)) / 2 + width.value / 4;
      const maxY = (height.value * (scale.value - 1)) / 2 + height.value / 4;
      tx.value = clamp(savedTx.value + e.translationX, -maxX, maxX);
      ty.value = clamp(savedTy.value + e.translationY, -maxY, maxY);
    })
    .onEnd(() => {
      savedTx.value = tx.value;
      savedTy.value = ty.value;
    });

  const doubleTap = Gesture.Tap()
    .numberOfTaps(2)
    .onEnd(() => {
      const zoomed = scale.value > ZOOM_MIN;
      const next = zoomed ? ZOOM_MIN : DOUBLE_TAP_SCALE;
      scale.value = withTiming(next);
      savedScale.value = next;
      tx.value = withTiming(0);
      ty.value = withTiming(0);
      savedTx.value = 0;
      savedTy.value = 0;
    });

  const composed = Gesture.Simultaneous(pinch, Gesture.Simultaneous(pan, doubleTap));

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: tx.value }, { translateY: ty.value }, { scale: scale.value }],
  }));

  return (
    <GestureDetector gesture={composed}>
      <Animated.View
        style={[styles.fill, style, animatedStyle]}
        onLayout={(e) => {
          width.value = e.nativeEvent.layout.width;
          height.value = e.nativeEvent.layout.height;
        }}
        accessibilityHint="Pinch to zoom, double tap to fit"
      >
        {children}
      </Animated.View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
});
