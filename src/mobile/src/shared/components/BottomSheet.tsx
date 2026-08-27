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
import { useReanimatedKeyboardAnimation } from "react-native-keyboard-controller";
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
  /**
   * Claims every pixel between the status bar and the keyboard, instead of
   * sizing to the content under an 80% cap. For sheets whose content is one
   * editable body (a description, a note) where the room to type IS the point.
   */
  fill?: boolean;
};

const ENTER_MS = 260;
const EXIT_MS = 200;
// Past a quarter of the sheet, or on a fast flick, the drag reads as dismiss.
const DISMISS_RATIO = 0.25;
const DISMISS_VELOCITY = 800;
// Floor for the keyboard-shrunk cap, so an unusually tall keyboard leaves a
// scrollable sheet rather than a sliver or a negative height.
const MIN_SHEET_HEIGHT = 160;
// Breathing room under the sheet's last control, on top of any safe-area inset.
const SHEET_PAD_BOTTOM = 8;
// What a `fill` sheet leaves below the status bar: enough backdrop to still be
// tappable, and enough to read as a sheet rather than a second screen.
const FILL_TOP_GAP = 12;

// Shared drawer shell: the modal, the backdrop, the grabber, and the drag that
// grabber implies. The animation is ours rather than Modal's animationType,
// because a Modal's own slide cannot be driven by a finger.
export function BottomSheet({
  visible,
  onClose,
  children,
  style,
  padBottom = true,
  fill = false,
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
  // Same source as KeyboardSpacer and the chat composer. RN's own
  // `Keyboard.endCoordinates.height` is NOT interchangeable here: on Android it
  // reports the ime inset without the toolbar/suggestion strip some keyboards
  // draw above it, which left the sheet lifted some 50dp short - exactly enough
  // to bury the composer it was lifting for.
  const keyboard = useReanimatedKeyboardAnimation();

  useEffect(() => {
    if (visible) {
      // `mounted` is a latch, not derived state: it has to outlive `visible`
      // going false so the exit animation can play to its end before the tree
      // unmounts. Nothing pure can express "true now, and still true for the
      // next 200ms", so the prop drives it from here.
      setMounted(true);
      translateY.value = reducedMotion ? 0 : withTiming(0, { duration: ENTER_MS });
      return;
    }
    if (reducedMotion) {
      translateY.value = sheetHeight;
      setMounted(false);
      return;
    }
    // A JS timer, not a withTiming completion callback: runOnJS from a
    // completion callback is a use-after-free on Android - worklets frees the
    // closure when the animation ends, and on a congested JS thread the queued
    // call runs after the free and aborts the process (reanimated#9786). This
    // sheet often exits at the busiest possible moment (a call just connected),
    // which made that race a process death on a large share of call joins. The
    // cleanup covers a reopen mid-exit, as the `finished` guard did before.
    translateY.value = withTiming(sheetHeight, { duration: EXIT_MS });
    const unmountTimer = setTimeout(() => setMounted(false), EXIT_MS);
    return () => clearTimeout(unmountTimer);
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

  // A Modal is its own window, so the shell's KeyboardSpacer cannot reach it and
  // KeyboardProvider has turned off Android's native resize - lifting the sheet
  // by the keyboard is what keeps a focused input visible. The cap has to shrink
  // by the same amount or the sheet is merely pushed, and a sheet that sets its
  // own height (see dmSheet, commentsSheet) would slide its header off the top.
  const sheetStyle = useAnimatedStyle(() => {
    const inset = -keyboard.height.value;
    const ceiling = fill ? windowHeight - insets.top - FILL_TOP_GAP : windowHeight * 0.8;
    const cap = Math.max(MIN_SHEET_HEIGHT, ceiling - inset);
    const base = {
      transform: [{ translateY: translateY.value }],
      bottom: inset,
      maxHeight: cap,
      // A cap alone only stops a sheet growing; the content still decides how
      // tall it is. Filling the space has to be stated as a height, or a short
      // body would sit in a small sheet with the room it asked for left empty.
      ...(fill ? { height: cap } : null),
    };
    if (!padBottom) return base;
    // The safe-area padding exists to clear the system nav bar at the bottom of
    // the screen. Lifted above the keyboard the sheet no longer touches that
    // edge, so the very same padding turns into a band of dead space between
    // the sheet's last control and the keys - on a three-button nav bar, some
    // 48dp of it.
    return {
      ...base,
      paddingBottom: (inset > 0 ? 0 : insets.bottom) + SHEET_PAD_BOTTOM,
    };
  });
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
            style,
            // After the caller's style, never before: a sheet that sets its own
            // height must not out-rank the keyboard clamp inside sheetStyle.
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
    ...StyleSheet.absoluteFill,
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
