import React, { useCallback, useEffect, useState } from "react";
import {
  Modal,
  Pressable,
  StyleSheet,
  View,
  useWindowDimensions,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { Gesture, GestureDetector, GestureHandlerRootView } from "react-native-gesture-handler";
import Animated, {
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
  withTiming,
  Extrapolation,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "@shared/hooks/useTheme";

type BottomSheetProps = {
  visible: boolean;
  onClose: () => void;
  children: React.ReactNode;
  /** Overrides the sheet container (height, maxHeight, radius). */
  style?: StyleProp<ViewStyle>;
  /** Safe-area bottom padding is applied unless the content owns its own. */
  padBottom?: boolean;
};

const ENTER_MS = 260;
const EXIT_MS = 200;
// Past a quarter of the sheet, or on a fast flick, the drag reads as dismiss.
const DISMISS_RATIO = 0.25;
const DISMISS_VELOCITY = 800;

// Shared drawer shell: the modal, the backdrop, the grabber, and the drag that
// grabber implies. The animation is ours rather than Modal's animationType,
// because a Modal's own slide cannot be driven by a finger.
export function BottomSheet({
  visible,
  onClose,
  children,
  style,
  padBottom = true,
}: BottomSheetProps) {
  const T = useTheme();
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const reducedMotion = useReducedMotion();

  // Kept mounted across the exit so the sheet can animate out; Modal would
  // otherwise tear it down the moment `visible` flips.
  const [mounted, setMounted] = useState(visible);
  const [sheetHeight, setSheetHeight] = useState(windowHeight);
  const translateY = useSharedValue(windowHeight);

  useEffect(() => {
    if (visible) {
      setMounted(true);
      translateY.value = reducedMotion ? 0 : withTiming(0, { duration: ENTER_MS });
      return;
    }
    if (reducedMotion) {
      translateY.value = sheetHeight;
      setMounted(false);
      return;
    }
    translateY.value = withTiming(sheetHeight, { duration: EXIT_MS }, (finished) => {
      if (finished) runOnJS(setMounted)(false);
    });
  }, [visible, reducedMotion, sheetHeight, translateY]);

  const onSheetLayout = useCallback(
    (h: number) => {
      setSheetHeight(h);
      // A sheet that has not opened yet parks off-screen at its real height, so
      // the first open does not slide in from an arbitrary window-height gap.
      if (!visible) translateY.value = h;
    },
    [visible, translateY],
  );

  // Only the grabber strip drags: most sheets hold a ScrollView, and a pan over
  // the whole surface would fight it for the gesture.
  const pan = Gesture.Pan()
    .onUpdate((e) => {
      translateY.value = Math.max(0, e.translationY);
    })
    .onEnd((e) => {
      const past = e.translationY > sheetHeight * DISMISS_RATIO;
      if (past || e.velocityY > DISMISS_VELOCITY) {
        translateY.value = withTiming(sheetHeight, { duration: EXIT_MS }, (finished) => {
          if (finished) runOnJS(onClose)();
        });
      } else {
        translateY.value = withSpring(0, { damping: 22, stiffness: 220 });
      }
    });

  const sheetStyle = useAnimatedStyle(() => ({ transform: [{ translateY: translateY.value }] }));
  const backdropStyle = useAnimatedStyle(() => ({
    opacity: interpolate(translateY.value, [0, sheetHeight], [1, 0], Extrapolation.CLAMP),
  }));

  if (!mounted) return null;

  return (
    <Modal visible transparent animationType="none" statusBarTranslucent onRequestClose={onClose}>
      {/* Android needs a root inside the modal for detectors to receive touches
        (the shell's root does not reach into a separate modal window). */}
      <GestureHandlerRootView style={styles.fill}>
        <Animated.View style={[styles.backdrop, backdropStyle]}>
          <Pressable style={styles.fill} onPress={onClose} accessibilityLabel="Close" />
        </Animated.View>

        <Animated.View
          style={[
            styles.sheet,
            { backgroundColor: T.surface },
            padBottom && { paddingBottom: insets.bottom + 8 },
            style,
            sheetStyle,
          ]}
          onLayout={(e) => onSheetLayout(e.nativeEvent.layout.height)}
        >
          <GestureDetector gesture={pan}>
            <View style={styles.grabZone}>
              <View style={[styles.handle, { backgroundColor: T.border }]} />
            </View>
          </GestureDetector>
          {children}
        </Animated.View>
      </GestureHandlerRootView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  fill: {
    flex: 1,
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.5)",
  },
  sheet: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    maxHeight: "80%",
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
  },
  // Wider than the grabber it draws: the drag has to be catchable without
  // hitting a 4px bar exactly.
  grabZone: {
    paddingTop: 8,
    paddingBottom: 6,
    alignItems: "center",
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
  },
});
