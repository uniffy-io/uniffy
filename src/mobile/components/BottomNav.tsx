import React, { useCallback, useEffect, useRef, useState } from "react";
import { View, Text, Pressable, StyleSheet, Platform, useWindowDimensions } from "react-native";
import { BlurView } from "expo-blur";
import * as Haptics from "expo-haptics";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { usePathname, router } from "expo-router";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { useReanimatedKeyboardAnimation } from "react-native-keyboard-controller";
import Animated, {
  runOnJS,
  useAnimatedReaction,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { At, House } from "phosphor-react-native";
import { useTheme } from "@/hooks/useTheme";
import { useUniffy } from "@/context/uniffy-context";
import { useUnreadNotificationCount } from "@/hooks/useNotifications";
import { FONT } from "@/constants/typography";
import { HubCarousel, HUB_ITEMS, HUB_RADIUS } from "@/components/HubCarousel";

export const BOTTOM_BAR_CONTENT_HEIGHT = 48;

const PX_PER_STEP = 70;
const CANCEL_DRAG_Y = 80;
const ITEM_COUNT = HUB_ITEMS.length;
const HINT_KEY = "@uniffy/hub_hint_seen";

// The wheel is endless - offsets are unbounded and map onto items modulo
// the ring size.
function modIndex(v: number): number {
  "worklet";
  return ((Math.round(v) % ITEM_COUNT) + ITEM_COUNT) % ITEM_COUNT;
}

function tickHaptic() {
  if (Platform.OS !== "web") {
    Haptics.selectionAsync().catch(() => {});
  }
}

export function bottomBarPadding(insetBottom: number): number {
  return Platform.OS === "web" ? 24 : insetBottom;
}

export function BottomNav() {
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const T = useTheme();
  const pathname = usePathname();
  const { atOpen, toggleAt } = useUniffy();
  const reducedMotion = useReducedMotion();
  const unreadQuery = useUnreadNotificationCount();
  const unread = unreadQuery.data ?? 0;

  const [open, setOpen] = useState(false);
  const [focusedIndex, setFocusedIndex] = useState(0);
  const [showHint, setShowHint] = useState(false);

  const offset = useSharedValue(0);
  const startOffset = useSharedValue(0);
  const dragging = useSharedValue(false);
  const domainIndexSV = useSharedValue(0);
  // Rotation anchor: the logo spins with the wheel's travel since open and
  // returns to its resting orientation as the selection settles.
  const spinOrigin = useSharedValue(0);

  const prevDomainPath = useRef<string | null>(null);
  const currentDomainPath = useRef<string | null>(null);

  const bottomPad = bottomBarPadding(insets.bottom);
  // The arc's apex sits just below mid-screen; the wheel center hangs below
  // it by the radius.
  const centerBottom = height / 2 - 48 - HUB_RADIUS;

  const domainIndex = HUB_ITEMS.findIndex((item) => pathname.startsWith(item.path));

  useEffect(() => {
    domainIndexSV.value = domainIndex >= 0 ? domainIndex : 0;
    const path = domainIndex >= 0 ? HUB_ITEMS[domainIndex].path : null;
    if (path && path !== currentDomainPath.current) {
      prevDomainPath.current = currentDomainPath.current;
      currentDomainPath.current = path;
    }
  }, [domainIndex, domainIndexSV]);

  useEffect(() => {
    AsyncStorage.getItem(HINT_KEY)
      .then((seen) => setShowHint(!seen))
      .catch(() => {});
  }, []);

  const openHub = useCallback(() => {
    const start = domainIndex >= 0 ? domainIndex : 0;
    offset.value = start;
    startOffset.value = start;
    spinOrigin.value = start;
    setFocusedIndex(start);
    setOpen(true);
  }, [domainIndex, offset, spinOrigin, startOffset]);

  const openHubFromDrag = useCallback((start: number) => {
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
      const item = HUB_ITEMS[modIndex(index)];
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
    () => modIndex(offset.value),
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
      const idx = Math.round(raw);
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
    (opensOnStart: boolean) =>
      Gesture.Pan()
        .onBegin(() => {
          startOffset.value = offset.value;
        })
        .onStart(() => {
          dragging.value = true;
          if (opensOnStart) {
            const start = domainIndexSV.value;
            offset.value = start;
            startOffset.value = start;
            spinOrigin.value = start;
            runOnJS(openHubFromDrag)(start);
          }
        })
        .onUpdate((e) => {
          offset.value = startOffset.value - e.translationX / PX_PER_STEP;
        })
        .onEnd((e) => {
          dragging.value = false;
          settleAndSelect(offset.value, e.translationY > CANCEL_DRAG_Y);
        }),
    [domainIndexSV, dragging, offset, openHubFromDrag, settleAndSelect, spinOrigin, startOffset],
  );

  const hubTap = Gesture.Tap()
    .maxDuration(220)
    .onStart(() => {
      runOnJS(toggleHub)();
    });
  const hubDoubleTap = Gesture.Tap()
    .numberOfTaps(2)
    .maxDelay(200)
    .onStart(() => {
      runOnJS(goPreviousDomain)();
    });
  const hubGesture = Gesture.Race(buildPan(true), Gesture.Exclusive(hubDoubleTap, hubTap));

  const backdropTap = Gesture.Tap().onStart(() => {
    runOnJS(closeHub)();
  });
  const backdropGesture = Gesture.Exclusive(buildPan(false), backdropTap);

  const logoStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${-(offset.value - spinOrigin.value) * 8}deg` }],
  }));

  // The bar rides on top of the keyboard so its buttons are never covered.
  const { height: keyboardHeight } = useReanimatedKeyboardAnimation();
  const barLiftStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: keyboardHeight.value }],
  }));

  const isHome = pathname === "/";

  return (
    <View style={styles.root} pointerEvents="box-none">
      <HubCarousel
        open={open}
        offset={offset}
        focusedIndex={focusedIndex}
        centerBottom={centerBottom}
        gesture={backdropGesture}
        showHint={showHint}
        onItemPress={selectIndex}
      />

      <Animated.View style={barLiftStyle}>
        <BlurView
          intensity={80}
          tint={T.isDark ? "dark" : "light"}
          style={[
            styles.bar,
            {
              borderTopColor: T.border,
              paddingBottom: bottomPad,
              backgroundColor: T.isDark ? "#0d111eaa" : "#ffffffaa",
            },
          ]}
        >
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
                source={require("../assets/images/uniffy-logo.png")}
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
              <House
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
        </BlurView>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 200,
    justifyContent: "flex-end",
  },
  bar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    height: undefined,
    minHeight: BOTTOM_BAR_CONTENT_HEIGHT,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 36,
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
