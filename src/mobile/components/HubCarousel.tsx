import React from "react";
import { StyleSheet, Text, Platform, Pressable, useWindowDimensions } from "react-native";
import { BlurView } from "expo-blur";
import { GestureDetector } from "react-native-gesture-handler";
import type { ComposedGesture, GestureType } from "react-native-gesture-handler";
import Animated, {
  FadeIn,
  interpolate,
  useAnimatedStyle,
  Extrapolation,
} from "react-native-reanimated";
import type { SharedValue } from "react-native-reanimated";
import {
  NotePencil,
  FolderSimple,
  ChatCircle,
  CalendarBlank,
  Kanban,
  Robot,
} from "phosphor-react-native";
import { useTheme } from "@/hooks/useTheme";
import { FONT } from "@/constants/typography";
import type { DomainKey } from "@/constants/theme";

export type HubItem = {
  key: DomainKey;
  label: string;
  path: string;
  Icon: React.ComponentType<{ size: number; color: string; weight: "duotone" }>;
};

export const HUB_ITEMS: HubItem[] = [
  { key: "chat", label: "Chat", path: "/chat", Icon: ChatCircle },
  { key: "calendar", label: "Calendar", path: "/calendar", Icon: CalendarBlank },
  { key: "notes", label: "Notes", path: "/notes", Icon: NotePencil },
  { key: "files", label: "Files", path: "/files", Icon: FolderSimple },
  { key: "projects", label: "Projects", path: "/projects", Icon: Kanban },
  { key: "agents", label: "Agents", path: "/agents", Icon: Robot },
];

// Degrees between adjacent items on the wheel; 90 deg is the apex.
export const HUB_STEP_DEG = 19;
export const HUB_RADIUS = 220;
const ITEM_SIZE = 54;

// The ring is endless: an item's distance from the apex is its index minus
// the offset, wrapped to the nearest representative so rotation never hits
// an end. Items fade out before the wrap point, hiding the position jump.
function wrapDelta(delta: number): number {
  "worklet";
  const n = HUB_ITEMS.length;
  const d = ((delta % n) + n) % n;
  return d >= n / 2 ? d - n : d;
}

type HubItemViewProps = {
  item: HubItem;
  index: number;
  offset: SharedValue<number>;
  centerBottom: number;
  centerX: number;
  focused: boolean;
  onPress: () => void;
};

function HubItemView({
  item,
  index,
  offset,
  centerBottom,
  centerX,
  focused,
  onPress,
}: HubItemViewProps) {
  const T = useTheme();
  const color = T.domains[item.key];
  const soft = T.domains[`${item.key}Soft`];

  const animatedStyle = useAnimatedStyle(() => {
    const delta = wrapDelta(index - offset.value);
    const angle = ((90 + delta * HUB_STEP_DEG) * Math.PI) / 180;
    const dist = Math.abs(delta);
    const scale = interpolate(dist, [0, 1], [1.28, 1], Extrapolation.CLAMP);
    const opacity = interpolate(dist, [0, 2.2, 2.8], [1, 0.85, 0], Extrapolation.CLAMP);
    return {
      left: centerX + HUB_RADIUS * Math.cos(angle) - ITEM_SIZE / 2,
      bottom: centerBottom + HUB_RADIUS * Math.sin(angle) - ITEM_SIZE / 2,
      transform: [{ scale }],
      opacity,
    };
  });

  return (
    <Animated.View style={[styles.item, animatedStyle]}>
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={item.label}
        style={[
          styles.itemInner,
          {
            backgroundColor: focused ? soft : T.surface,
            borderColor: focused ? color : T.border,
          },
        ]}
      >
        <item.Icon size={24} color={focused ? color : T.textDim} weight="duotone" />
      </Pressable>
    </Animated.View>
  );
}

type HubCarouselProps = {
  open: boolean;
  offset: SharedValue<number>;
  focusedIndex: number;
  centerBottom: number;
  gesture: ComposedGesture | GestureType;
  showHint: boolean;
  onItemPress: (index: number) => void;
};

export function HubCarousel({
  open,
  offset,
  focusedIndex,
  centerBottom,
  gesture,
  showHint,
  onItemPress,
}: HubCarouselProps) {
  const T = useTheme();
  const { width } = useWindowDimensions();

  if (!open) return null;

  const focusedItem = HUB_ITEMS[focusedIndex];
  const labelBottom = centerBottom + HUB_RADIUS + ITEM_SIZE / 2 + 22;

  return (
    <Animated.View entering={FadeIn.duration(140)} style={StyleSheet.absoluteFill}>
      <GestureDetector gesture={gesture}>
        <Animated.View style={StyleSheet.absoluteFill}>
          <BlurView
            intensity={30}
            tint={T.isDark ? "dark" : "light"}
            style={[styles.backdrop, { backgroundColor: T.isDark ? "#0d111ecc" : "#eeeeeecc" }]}
          />
        </Animated.View>
      </GestureDetector>

      <Text
        style={[
          styles.label,
          { color: T.domains[focusedItem.key], bottom: labelBottom, pointerEvents: "none" },
        ]}
      >
        {focusedItem.label}
      </Text>
      {showHint && (
        <Text
          style={[
            styles.hint,
            { color: T.textDim, bottom: labelBottom + 30, pointerEvents: "none" },
          ]}
        >
          Drag to rotate, release to open
        </Text>
      )}

      {HUB_ITEMS.map((item, i) => (
        <HubItemView
          key={item.key}
          item={item}
          index={i}
          offset={offset}
          centerBottom={centerBottom}
          centerX={width / 2}
          focused={i === focusedIndex}
          onPress={() => onItemPress(i)}
        />
      ))}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFillObject,
  },
  item: {
    position: "absolute",
    width: ITEM_SIZE,
    height: ITEM_SIZE,
  },
  itemInner: {
    flex: 1,
    borderRadius: ITEM_SIZE / 2,
    borderWidth: 1.5,
    alignItems: "center",
    justifyContent: "center",
    ...(Platform.OS === "web" ? { cursor: "pointer" as any } : null),
  },
  label: {
    position: "absolute",
    left: 0,
    right: 0,
    textAlign: "center",
    fontSize: 17,
    fontFamily: FONT.bold,
    letterSpacing: 0.3,
  },
  hint: {
    position: "absolute",
    left: 0,
    right: 0,
    textAlign: "center",
    fontSize: 12,
    fontFamily: FONT.regular,
  },
});
