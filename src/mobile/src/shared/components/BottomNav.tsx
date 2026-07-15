import React, { useCallback, useEffect, useRef, useState } from "react";
import { View, Text, Pressable, StyleSheet, Platform, Keyboard, useWindowDimensions } from "react-native";
import * as Haptics from "expo-haptics";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { usePathname, router } from "expo-router";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { useReanimatedKeyboardAnimation } from "react-native-keyboard-controller";
import Animated, {
  cancelAnimation,
  runOnJS,
  useAnimatedReaction,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { At, House } from "phosphor-react-native";
import { useTheme } from "@shared/hooks/useTheme";
import { useUniffy } from "@core/providers/uniffy-context";
import { FONT } from "@theme/typography";
import {
  HubCarousel,
  HUB_CENTER_INDEX,
  HUB_ITEMS,
  HUB_RADIUS,
} from "@shared/components/HubCarousel";
import { GlassSurface } from "@shared/components/GlassSurface";

export const BOTTOM_BAR_CONTENT_HEIGHT = 48;

const PX_PER_STEP = 70;
const CANCEL_DRAG_Y = 80;
// Press-and-hold threshold that opens the wheel without movement. Taps up to
// this duration stay taps, so there is no dead window between the two.
const HOLD_OPEN_MS = 320;
const ITEM_COUNT = HUB_ITEMS.length;
const HINT_KEY = "@uniffy/hub_hint_seen";

// The wheel is bounded: one position per item, rotation stops at both ends.
function clampIndex(v: number): number {
  "worklet";
  return Math.min(Math.max(Math.round(v), 0), ITEM_COUNT - 1);
}

function tickHaptic() {
  if (Platform.OS !== "web") {
    Haptics.selectionAsync().catch(() => {});
  }
}

function pressHaptic() {
  if (Platform.OS !== "web") {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
  }
}

export function bottomBarPadding(insetBottom: number): number {
  return Platform.OS === "web" ? 24 : insetBottom;
}

export function bottomBarMargin(insetBottom: number): number {
  return Math.max(bottomBarPadding(insetBottom), 12);
}

// Total vertical space the floating bar block occupies at the bottom edge:
// bar plus its bottom margin. Content the bar overlays insets by this much
// so it can scroll clear of the glass.
export function bottomBarBlockHeight(insetBottom: number): number {
  return BOTTOM_BAR_CONTENT_HEIGHT + 8 + bottomBarMargin(insetBottom);
}

type BottomNavProps = {
  unreadCount?: number;
};

export function BottomNav({ unreadCount = 0 }: BottomNavProps) {
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const T = useTheme();
  const pathname = usePathname();
  const { atOpen, toggleAt } = useUniffy();
  const reducedMotion = useReducedMotion();
  const unread = unreadCount;

  const [open, setOpen] = useState(false);
  const [focusedIndex, setFocusedIndex] = useState(0);
  const [showHint, setShowHint] = useState(false);

  const offset = useSharedValue(0);
  const startOffset = useSharedValue(0);
  const dragging = useSharedValue(false);
  // Rotation anchor: the logo spins with the wheel's travel since open and
  // returns to its resting orientation as the selection settles.
  const spinOrigin = useSharedValue(0);
  const hubNudge = useSharedValue(0);

  const prevDomainPath = useRef<string | null>(null);
  const currentDomainPath = useRef<string | null>(null);

  const barMargin = bottomBarMargin(insets.bottom);
  // The arc's apex sits just below mid-screen; the wheel center hangs below
  // it by the radius.
  const centerBottom = height / 2 - 48 - HUB_RADIUS;

  const domainIndex = HUB_ITEMS.findIndex((item) => pathname.startsWith(item.path));

  useEffect(() => {
    const path = domainIndex >= 0 ? HUB_ITEMS[domainIndex].path : null;
    if (path && path !== currentDomainPath.current) {
      prevDomainPath.current = currentDomainPath.current;
      currentDomainPath.current = path;
    }
  }, [domainIndex]);

  useEffect(() => {
    AsyncStorage.getItem(HINT_KEY)
      .then((seen) => setShowHint(!seen))
      .catch(() => {});
  }, []);

  // First-use affordance: until the wheel has been used once, the logo sways
  // sideways every few seconds, miming the drag that opens it.
  useEffect(() => {
    if (!showHint || open || reducedMotion) {
      cancelAnimation(hubNudge);
      hubNudge.value = withTiming(0, { duration: 120 });
      return;
    }
    hubNudge.value = withRepeat(
      withSequence(
        withDelay(2400, withTiming(-7, { duration: 160 })),
        withTiming(7, { duration: 220 }),
        withTiming(-4, { duration: 180 }),
        withTiming(0, { duration: 160 }),
      ),
      -1,
    );
    return () => cancelAnimation(hubNudge);
  }, [showHint, open, reducedMotion, hubNudge]);

  const openHub = useCallback(() => {
    // The wheel needs the bottom half of the screen; an open keyboard would
    // cover it.
    Keyboard.dismiss();
    offset.value = HUB_CENTER_INDEX;
    startOffset.value = HUB_CENTER_INDEX;
    spinOrigin.value = HUB_CENTER_INDEX;
    setFocusedIndex(HUB_CENTER_INDEX);
    setOpen(true);
  }, [offset, spinOrigin, startOffset]);

  const openHubFromDrag = useCallback((start: number) => {
    Keyboard.dismiss();
    setFocusedIndex(start);
    setOpen(true);
  }, []);

  const closeHub = useCallback(() => {
    setOpen(false);
    dragging.value = false;
  }, [dragging]);

  const markHintSeen = useCallback(() => {
    setShowHint(false);
    AsyncStorage.setItem(HINT_KEY, "1").catch(() => {});
  }, []);

  const selectIndex = useCallback(
    (index: number) => {
      markHintSeen();
      closeHub();
      const item = HUB_ITEMS[clampIndex(index)];
      if (!pathname.startsWith(item.path)) {
        router.push(item.path as any);
      }
    },
    [closeHub, markHintSeen, pathname],
  );

  const toggleHub = useCallback(() => {
    if (open) {
      closeHub();
    } else {
      openHub();
    }
  }, [open, openHub, closeHub]);

  const goPreviousDomain = useCallback(() => {
    if (prevDomainPath.current) {
      router.push(prevDomainPath.current as any);
    }
  }, []);

  useAnimatedReaction(
    () => clampIndex(offset.value),
    (curr, prev) => {
      if (prev !== null && curr !== prev) {
        runOnJS(setFocusedIndex)(curr);
        if (dragging.value) {
          runOnJS(tickHaptic)();
        }
      }
    },
  );

  const settleAndSelect = useCallback(
    (raw: number, cancelled: boolean) => {
      "worklet";
      const idx = clampIndex(raw);
      offset.value = reducedMotion
        ? withTiming(idx, { duration: 80 })
        : withSpring(idx, {
            damping: 18,
            stiffness: 180,
          });
      spinOrigin.value = reducedMotion
        ? withTiming(idx, { duration: 80 })
        : withSpring(idx, {
            damping: 18,
            stiffness: 180,
          });
      if (cancelled) {
        runOnJS(closeHub)();
      } else {
        runOnJS(selectIndex)(idx);
      }
    },
    [closeHub, offset, reducedMotion, selectIndex, spinOrigin],
  );

  const buildPan = useCallback(
    (opensOnStart: boolean, holdMs?: number) => {
      const pan = Gesture.Pan()
        .onBegin(() => {
          startOffset.value = offset.value;
        })
        .onStart(() => {
          dragging.value = true;
          if (holdMs) {
            runOnJS(pressHaptic)();
          }
          if (opensOnStart) {
            offset.value = HUB_CENTER_INDEX;
            startOffset.value = HUB_CENTER_INDEX;
            spinOrigin.value = HUB_CENTER_INDEX;
            runOnJS(openHubFromDrag)(HUB_CENTER_INDEX);
          }
        })
        .onUpdate((e) => {
          const raw = startOffset.value - e.translationX / PX_PER_STEP;
          const max = ITEM_COUNT - 1;
          // Past either end the drag keeps a quarter of its travel: the wheel
          // resists instead of wrapping, and the settle spring pulls it back.
          offset.value = raw < 0 ? raw * 0.25 : raw > max ? max + (raw - max) * 0.25 : raw;
        })
        .onEnd((e) => {
          dragging.value = false;
          settleAndSelect(offset.value, e.translationY > CANCEL_DRAG_Y);
        });
      // A held finger activates the pan after holdMs with no movement, so the
      // same touch keeps rotating the wheel; moving early fails this instance
      // and the plain swipe pan in the race takes the gesture instead.
      return holdMs ? pan.activateAfterLongPress(holdMs) : pan;
    },
    [dragging, offset, openHubFromDrag, settleAndSelect, spinOrigin, startOffset],
  );

  const hubTap = Gesture.Tap()
    .maxDuration(HOLD_OPEN_MS)
    .onStart(() => {
      runOnJS(toggleHub)();
    });
  const hubDoubleTap = Gesture.Tap()
    .numberOfTaps(2)
    .maxDelay(200)
    .onStart(() => {
      runOnJS(goPreviousDomain)();
    });
  const hubGesture = Gesture.Race(
    buildPan(true),
    buildPan(true, HOLD_OPEN_MS),
    Gesture.Exclusive(hubDoubleTap, hubTap),
  );

  const backdropTap = Gesture.Tap().onStart(() => {
    runOnJS(closeHub)();
  });
  const backdropGesture = Gesture.Exclusive(buildPan(false), backdropTap);

  const logoStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: hubNudge.value },
      { rotate: `${-(offset.value - spinOrigin.value) * 8}deg` },
    ],
  }));

  const isHome = pathname === "/";

  // The keyboard replaces the bar: the block collapses to zero height as the
  // keyboard rises. Height is real layout on purpose - opacity or transforms
  // above the GlassSurface would drop it to a plain view (expo/expo#41024).
  const { progress: keyboardProgress } = useReanimatedKeyboardAnimation();
  const blockHeight = bottomBarBlockHeight(insets.bottom);
  const collapseStyle = useAnimatedStyle(() => {
    const p = Math.min(Math.max(keyboardProgress.value, 0), 1);
    return { height: (1 - p) * blockHeight };
  });

  // Rendered as a flow block, not an absolute overlay: on iOS 26 Fabric an
  // inset-positioned shell overlay stays in flow layout anyway (it steals
  // Stack height), so the bar reserves its space honestly and the shell's
  // KeyboardSpacer lifts content above the keyboard.
  return (
    <>
      <HubCarousel
        open={open}
        offset={offset}
        focusedIndex={focusedIndex}
        centerBottom={centerBottom}
        gesture={backdropGesture}
        showHint={showHint}
        onItemPress={selectIndex}
        onRequestClose={closeHub}
      />

      <Animated.View style={[styles.barClip, collapseStyle]}>
        <View
          style={[
            styles.barContainer,
            {
              marginBottom: barMargin,
              borderColor: T.isDark ? "rgba(255,255,255,0.14)" : "rgba(0,0,0,0.08)",
            },
          ]}
        >
          <GlassSurface
            style={StyleSheet.absoluteFill}
            tintColor={T.isDark ? "rgba(20,22,34,0.22)" : "rgba(255,255,255,0.35)"}
            interactive
            isDark={T.isDark}
            blurIntensity={48}
            solidColor={T.bg}
          />
          <View style={styles.bar}>
            <Pressable
              style={styles.sideButton}
              onPress={toggleAt}
              accessibilityRole="button"
              accessibilityLabel="References"
            >
              <At size={27} color={atOpen ? T.accent : T.textDim} weight="bold" />
          </Pressable>

          <GestureDetector gesture={hubGesture}>
            <Animated.View
              style={styles.hubButton}
              accessibilityRole="button"
              accessibilityLabel="Switch domain"
            >
              <Animated.Image
                source={require("../../../assets/images/uniffy-logo.png")}
                style={[styles.hubLogo, logoStyle]}
                resizeMode="contain"
              />
            </Animated.View>
          </GestureDetector>

          <Pressable
            style={styles.sideButton}
            onPress={() => {
              if (!isHome) router.push("/");
            }}
            accessibilityRole="button"
            accessibilityLabel="Home"
          >
            <View style={styles.homeWrap}>
              {/* key remounts the icon on weight flips: react-native-svg fails
                  to re-resolve currentColor when the path swaps in-place and
                  paints it black. */}
              <House
                key={isHome ? "fill" : "duotone"}
                size={27}
                color={isHome ? T.accent : T.textDim}
                weight={isHome ? "fill" : "duotone"}
              />
              {unread > 0 && (
                <View style={[styles.badge, { backgroundColor: T.red, borderColor: T.bg }]}>
                  <Text style={styles.badgeText}>{unread > 99 ? "99+" : unread}</Text>
                </View>
              )}
            </View>
          </Pressable>
          </View>
        </View>
      </Animated.View>
    </>
  );
}

const styles = StyleSheet.create({
  barClip: {
    overflow: "hidden",
    justifyContent: "flex-start",
  },
  barContainer: {
    marginHorizontal: 14,
    borderRadius: BOTTOM_BAR_CONTENT_HEIGHT / 2 + 4,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: "hidden",
  },
  bar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    minHeight: BOTTOM_BAR_CONTENT_HEIGHT + 8,
    paddingHorizontal: 22,
  },
  sideButton: {
    width: 64,
    height: BOTTOM_BAR_CONTENT_HEIGHT,
    alignItems: "center",
    justifyContent: "center",
  },
  hubButton: {
    width: 64,
    height: BOTTOM_BAR_CONTENT_HEIGHT,
    alignItems: "center",
    justifyContent: "center",
  },
  hubLogo: {
    width: 36,
    height: 36,
  },
  homeWrap: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  badge: {
    position: "absolute",
    top: 0,
    right: -4,
    minWidth: 17,
    height: 17,
    borderRadius: 9,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 3,
  },
  badgeText: {
    fontSize: 9,
    fontFamily: FONT.bold,
    color: "#ffffff",
  },
});
