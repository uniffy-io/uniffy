import React, { useRef, useEffect } from "react";
import {
  TouchableOpacity,
  StyleSheet,
  Platform,
  Animated,
  PanResponder,
  useWindowDimensions,
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { X } from "phosphor-react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useUniffy } from "@/context/uniffy-context";
import { useTheme } from "@/hooks/useTheme";
import { usePathname } from "expo-router";
import { BOTTOM_NAV_HEIGHT } from "@/constants/theme";
import { TOP_NAV_CONTENT_HEIGHT } from "@/components/TopNav";

const EDITOR_PATHS = [
  "/notes/edit",
  "/chat/",
  "/calendar/create",
  "/projects/create",
  "/projects/task/create",
];
const FAB_SIZE = 38;
const CLOSE_SIZE = 36;
const STORAGE_KEY = "@uniffy/fab_position";

export function AtFab() {
  const insets = useSafeAreaInsets();
  const T = useTheme();
  const { atOpen, openAt, closeAt, atPosition } = useUniffy();
  const pathname = usePathname();
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();

  const isEditorContext = EDITOR_PATHS.some((p) => pathname.includes(p));

  const topNavHeight = (Platform.OS === "web" ? 20 : insets.top) + TOP_NAV_CONTENT_HEIGHT;
  const fabBottomOffset =
    Platform.OS === "web" ? BOTTOM_NAV_HEIGHT + 34 + 16 : BOTTOM_NAV_HEIGHT + insets.bottom + 16;

  // Default FAB position: bottom-right corner
  const defaultFabX = screenWidth - FAB_SIZE - 14;
  const defaultFabY = screenHeight - fabBottomOffset - FAB_SIZE;

  // Close button position: fixed top-right, centered with 42px search bar
  const openX = screenWidth - CLOSE_SIZE - 16;
  const openTop = topNavHeight + 12 + (42 - CLOSE_SIZE) / 2;

  // Actual rendered BottomNav height: paddingTop(8) + icon(21) + gap(3) + label(~14) + insets.bottom
  const actualNavHeight = 46 + (Platform.OS === "web" ? 34 : insets.bottom);
  // Max Y the FAB can be dragged to: just above the nav with a 4px gap
  const dragMaxY = screenHeight - actualNavHeight - FAB_SIZE - 4;
  const dragMinY = topNavHeight + 8;

  // Refs accessed inside the stable panResponder closure
  const atOpenRef = useRef(atOpen);
  const fabPosRef = useRef({ x: defaultFabX, y: defaultFabY });
  const screenRef = useRef({ width: screenWidth, dragMinY, dragMaxY });
  const openPosRef = useRef({ x: openX, y: openTop });

  useEffect(() => {
    atOpenRef.current = atOpen;
  }, [atOpen]);
  useEffect(() => {
    screenRef.current = { width: screenWidth, dragMinY, dragMaxY };
  }, [screenWidth, dragMinY, dragMaxY]);
  useEffect(() => {
    openPosRef.current = { x: openX, y: openTop };
  }, [openX, openTop]);

  // Animated values: morphAnim drives visual change, posAnim drives position
  const morphAnim = useRef(new Animated.Value(0)).current;
  const posAnim = useRef(new Animated.ValueXY({ x: defaultFabX, y: defaultFabY })).current;

  // Load persisted FAB position from storage on first mount
  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY).then((val) => {
      if (!val) return;
      try {
        const saved = JSON.parse(val) as { x: number; y: number };
        const { width, dragMinY: minY, dragMaxY: maxY } = screenRef.current;
        const clampedX = Math.max(0, Math.min(width - FAB_SIZE, saved.x));
        const clampedY = Math.max(minY, Math.min(maxY, saved.y));
        fabPosRef.current = { x: clampedX, y: clampedY };
        posAnim.setValue({ x: clampedX, y: clampedY });
      } catch {}
    });
  }, []);

  // Animate morph + position when overlay opens or closes
  useEffect(() => {
    const targetPos = atOpen ? openPosRef.current : fabPosRef.current;
    Animated.parallel([
      Animated.spring(morphAnim, {
        toValue: atOpen ? 1 : 0,
        useNativeDriver: false,
        tension: 65,
        friction: 11,
      }),
      Animated.spring(posAnim, {
        toValue: targetPos,
        useNativeDriver: false,
        tension: 65,
        friction: 11,
      }),
    ]).start();
  }, [atOpen]);

  const panResponder = useRef(
    PanResponder.create({
      // Never steal a tap — only activate when there is real movement
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (_, gs) =>
        !atOpenRef.current && (Math.abs(gs.dx) > 6 || Math.abs(gs.dy) > 6),

      onPanResponderGrant: () => {
        // Move current value into the offset so gesture deltas are relative
        posAnim.extractOffset();
      },

      onPanResponderMove: Animated.event([null, { dx: posAnim.x, dy: posAnim.y }], {
        useNativeDriver: false,
      }),

      onPanResponderRelease: (_, gs) => {
        posAnim.flattenOffset();

        const { width, dragMinY: minY, dragMaxY: maxY } = screenRef.current;

        // Compute raw final position from pre-drag position + gesture total delta
        const rawX = fabPosRef.current.x + gs.dx;
        const rawY = fabPosRef.current.y + gs.dy;

        // Snap to nearest horizontal edge for polished FAB behaviour
        const snapX = rawX + FAB_SIZE / 2 < width / 2 ? 8 : width - FAB_SIZE - 8;
        const clampedY = Math.max(minY, Math.min(maxY, rawY));

        const finalPos = { x: snapX, y: clampedY };
        fabPosRef.current = finalPos;

        Animated.spring(posAnim, {
          toValue: finalPos,
          useNativeDriver: false,
          tension: 100,
          friction: 12,
        }).start();

        AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(finalPos));
      },

      onPanResponderTerminate: () => {
        posAnim.flattenOffset();
      },
    }),
  ).current;

  if (atPosition !== "fab") return null;

  const handlePress = () => {
    if (atOpen) {
      closeAt();
    } else {
      openAt(isEditorContext);
    }
  };

  const buttonSize = morphAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [FAB_SIZE, CLOSE_SIZE],
  });
  const borderRadius = morphAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [FAB_SIZE / 2, CLOSE_SIZE / 2],
  });
  const atOpacity = morphAnim.interpolate({ inputRange: [0, 0.35, 1], outputRange: [1, 0, 0] });
  const xOpacity = morphAnim.interpolate({ inputRange: [0, 0.65, 1], outputRange: [0, 0, 1] });
  const bgColor = morphAnim.interpolate({ inputRange: [0, 1], outputRange: [T.surface, T.accent] });
  const borderColor = morphAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [T.border, T.accent],
  });

  return (
    <Animated.View
      style={[
        styles.button,
        {
          left: posAnim.x,
          top: posAnim.y,
          width: buttonSize,
          height: buttonSize,
          borderRadius,
          backgroundColor: bgColor,
          borderColor,
          shadowColor: T.accent,
        },
      ]}
      {...panResponder.panHandlers}
    >
      <TouchableOpacity style={styles.inner} onPress={handlePress} activeOpacity={0.85}>
        <Animated.Text style={[styles.atSymbol, { color: T.accent, opacity: atOpacity }]}>
          @
        </Animated.Text>
        <Animated.View style={[StyleSheet.absoluteFill, styles.xWrap, { opacity: xOpacity }]}>
          <X size={15} color="#fff" weight="bold" />
        </Animated.View>
      </TouchableOpacity>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  button: {
    position: "absolute",
    borderWidth: 1.5,
    zIndex: 300,
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.2,
    shadowRadius: 6,
    elevation: 5,
    overflow: "hidden",
  },
  inner: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  atSymbol: {
    fontSize: 17,
    fontFamily: "Inter_700Bold",
    lineHeight: 20,
    textAlign: "center",
    marginTop: -2,
  },
  xWrap: {
    alignItems: "center",
    justifyContent: "center",
  },
});
