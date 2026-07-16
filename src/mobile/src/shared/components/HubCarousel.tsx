import React from "react";
import {
  Modal,
  StyleSheet,
  Text,
  View,
  Platform,
  Pressable,
  useWindowDimensions,
} from "react-native";
import { BlurView } from "expo-blur";
import { GlassSurface } from "@shared/components/GlassSurface";
import { GestureDetector, GestureHandlerRootView } from "react-native-gesture-handler";
import type { ComposedGesture, GestureType } from "react-native-gesture-handler";
import Animated, { interpolate, useAnimatedStyle, Extrapolation } from "react-native-reanimated";
import type { SharedValue } from "react-native-reanimated";
import { NotePencil, FolderSimple, ChatCircle, CalendarBlank, Kanban } from "phosphor-react-native";
import { useTheme } from "@shared/hooks/useTheme";
import { FONT } from "@theme/typography";
import type { DomainKey } from "@theme/theme";

export type HubItem = {
  key: DomainKey;
  label: string;
  path: string;
  Icon: React.ComponentType<{ size: number; color: string; weight: "duotone" }>;
};

// Chat holds the middle slot: the wheel opens centered on it, and only the
// center position keeps every item's arc spot on screen at once.
export const HUB_ITEMS: HubItem[] = [
  { key: "calendar", label: "Calendar", path: "/calendar", Icon: CalendarBlank },
  { key: "notes", label: "Notes", path: "/notes", Icon: NotePencil },
  { key: "chat", label: "Chat", path: "/chat", Icon: ChatCircle },
  { key: "files", label: "Files", path: "/files", Icon: FolderSimple },
  { key: "projects", label: "Projects", path: "/projects", Icon: Kanban },
];

export const HUB_CENTER_INDEX = Math.floor(HUB_ITEMS.length / 2);

// Degrees between adjacent items on the wheel; 90 deg is the apex.
export const HUB_STEP_DEG = 19;
export const HUB_RADIUS = 220;
const ITEM_SIZE = 54;

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

  const animatedStyle = useAnimatedStyle(() => {
    const delta = index - offset.value;
    const angle = ((90 + delta * HUB_STEP_DEG) * Math.PI) / 180;
    const dist = Math.abs(delta);
    // Emphasis is real width/height layout, never transform or opacity: a
    // GlassView under an ancestor with an animated opacity or transform
    // silently renders as a plain view (expo/expo#41024).
    const size =
      ITEM_SIZE * interpolate(dist, [0, 1, 2.5, 4], [1.28, 1, 0.85, 0.45], Extrapolation.CLAMP);
    return {
      width: size,
      height: size,
      left: centerX + HUB_RADIUS * Math.cos(angle) - size / 2,
      bottom: centerBottom + HUB_RADIUS * Math.sin(angle) - size / 2,
    };
  });

  return (
    <Animated.View
      style={[
        styles.item,
        animatedStyle,
        focused && { shadowColor: T.textBright },
        focused && styles.itemShadowFocused,
      ]}
    >
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={item.label}
        style={[styles.itemInner, { borderColor: focused ? T.textBright : T.border }]}
      >
        {/* Selection stays neutral: the focused bubble reads from a brighter
            border, icon, and glow over the theme glass, so it holds in dark and
            light without any color tint. */}
        <GlassSurface
          style={StyleSheet.absoluteFill}
          interactive
          isDark={T.isDark}
          blurIntensity={focused ? 70 : 36}
          solidColor={T.surface}
        />
        <item.Icon size={24} color={focused ? T.textBright : T.textDim} weight="duotone" />
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
  onRequestClose: () => void;
};

export function HubCarousel({
  open,
  offset,
  focusedIndex,
  centerBottom,
  gesture,
  showHint,
  onItemPress,
  onRequestClose,
}: HubCarouselProps) {
  const T = useTheme();
  const { width } = useWindowDimensions();

  if (!open) return null;

  const focusedItem = HUB_ITEMS[focusedIndex];
  const labelBottom = centerBottom + HUB_RADIUS + ITEM_SIZE / 2 + 22;

  return (
    // A Modal, not an absolute-fill sibling: a shell-level inset overlay can
    // collapse into flow layout on iOS 26 Fabric (LoginSplash and AtOverlay
    // hit the same bug). The Modal hosts its own full-screen root, and it
    // needs its own GestureHandlerRootView for the detectors to work on
    // Android. The in-progress pan that opened the wheel stays with the
    // logo's detector in the main window; only new touches land here.
    <Modal
      visible
      transparent
      animationType="none"
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={onRequestClose}
    >
      <GestureHandlerRootView style={styles.fill}>
        <GestureDetector gesture={gesture}>
          {/* The backdrop mounts with no animation: a Reanimated entering fade
            on an absolute-fill view collapses it on iOS 26 Fabric so it
            never draws, and animated opacity above glass would break the
            bubbles anyway (expo/expo#41024). Strong enough that text or file
            pages behind cannot compete with the wheel's icons, while the page
            stays faintly recognizable. */}
          <View style={StyleSheet.absoluteFill} collapsable={false}>
            <BlurView
              intensity={55}
              tint={T.isDark ? "dark" : "light"}
              style={[styles.backdrop, { backgroundColor: T.isDark ? "#0d111ee6" : "#eeeeeee6" }]}
            />
          </View>
        </GestureDetector>

        <Text
          style={[
            styles.label,
            { color: T.textBright, bottom: labelBottom, pointerEvents: "none" },
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
  },
  item: {
    position: "absolute",
  },
  itemShadowFocused: {
    shadowOpacity: 0.5,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 4 },
    elevation: 10,
  },
  itemInner: {
    flex: 1,
    // Bubbles resize with wheel distance; an oversized radius keeps them
    // circular at every animated size.
    borderRadius: 999,
    borderWidth: 1.5,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
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
