import React, { useEffect, useRef } from "react";
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import Svg, { Polygon } from "react-native-svg";
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withTiming,
} from "react-native-reanimated";
import { BookmarkSimple } from "phosphor-react-native";
import { useTheme } from "@shared/hooks/useTheme";
import { FONT } from "@theme/typography";
import { withAlpha } from "@theme/brandRamp";
import type { UrnType } from "@shared/lib/contentTypes";
import { LIBRARY_TYPES, libraryTypeColor } from "@features/library/libraryTypes";

const RIBBON_W = 40;
const REST_H = 44;
const ACTIVE_H = 64;
const NOTCH = 9;
// The glyph sits this far above the ribbon's lowest point, clear of the notch.
const ICON_LIFT = 14;
const DROP_MS = 450;
const DROP_STAGGER_MS = 35;
// Every column is exactly one ribbon wide, so the gap between ribbons is the
// rail gap and nothing else; a label wider than its ribbon hangs out evenly on
// both sides and is cut before it reaches the neighbour's.
const RAIL_GAP = 14;
const POINTS = `0,0 ${RIBBON_W},0 ${RIBBON_W},${ACTIVE_H} ${RIBBON_W / 2},${ACTIVE_H - NOTCH} 0,${ACTIVE_H}`;

interface RibbonProps {
  active: boolean;
  color: string;
  label: string;
  icon: React.ReactNode;
  activeIcon: React.ReactNode;
  index: number;
  /** Drop in from above the rail on mount; off for ribbons that join a rail already hanging. */
  drop: boolean;
  onPress: () => void;
}

// Nothing here animates layout. Every ribbon is drawn at its full height and a
// resting one is slid up under the rail's top edge, which clips it to the short
// form; selecting slides it down. The solid fill and the white glyph sit on top
// of the tinted ones and fade in. Transforms and opacity stay on the UI thread,
// where a height change would re-run layout on every frame.
function Ribbon({ active, color, label, icon, activeIcon, index, drop, onPress }: RibbonProps) {
  const T = useTheme();
  const reducedMotion = useReducedMotion();
  const lowered = useSharedValue(active ? 1 : 0);
  // 1 = still tucked above the rail; each ribbon drops in a beat after the last.
  const tucked = useSharedValue(drop && !reducedMotion ? 1 : 0);

  useEffect(() => {
    lowered.value = withTiming(active ? 1 : 0, {
      duration: 300,
      easing: Easing.out(Easing.cubic),
    });
  }, [active, lowered]);

  useEffect(() => {
    if (!drop || reducedMotion) return;
    tucked.value = withDelay(
      index * DROP_STAGGER_MS,
      withTiming(0, { duration: DROP_MS, easing: Easing.bezier(0.22, 1, 0.36, 1) }),
    );
  }, [drop, index, reducedMotion, tucked]);

  const columnStyle = useAnimatedStyle(() => ({
    opacity: 1 - tucked.value,
    transform: [
      {
        translateY: -tucked.value * ACTIVE_H * 1.1 - (1 - lowered.value) * (ACTIVE_H - REST_H),
      },
    ],
  }));
  const activeStyle = useAnimatedStyle(() => ({ opacity: lowered.value }));
  const restStyle = useAnimatedStyle(() => ({ opacity: 1 - lowered.value }));

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      accessibilityLabel={label}
    >
      <Animated.View style={[styles.ribbon, columnStyle]}>
        <View style={styles.body}>
          <Svg width={RIBBON_W} height={ACTIVE_H} style={StyleSheet.absoluteFill}>
            <Polygon points={POINTS} fill={withAlpha(color, 0.16)} />
          </Svg>
          <Animated.View
            style={[
              StyleSheet.absoluteFill,
              activeStyle,
              Platform.OS === "ios" && { shadowColor: color, ...styles.activeShadow },
            ]}
            pointerEvents="none"
          >
            <Svg width={RIBBON_W} height={ACTIVE_H}>
              <Polygon points={POINTS} fill={color} />
            </Svg>
          </Animated.View>
          <View style={styles.iconSlot} pointerEvents="none">
            <Animated.View style={restStyle}>{icon}</Animated.View>
            <Animated.View style={[styles.iconOverlay, activeStyle]}>{activeIcon}</Animated.View>
          </View>
        </View>
        <Text style={[styles.label, { color: active ? color : T.textDim }]} numberOfLines={1}>
          {label.toUpperCase()}
        </Text>
      </Animated.View>
    </Pressable>
  );
}

interface RibbonRailProps {
  types: UrnType[];
  selected: UrnType[];
  onChange: (next: UrnType[]) => void;
}

/** The type filters, hung from the edge above as notched bookmark ribbons; multi-select, "All" clears. */
export function RibbonRail({ types, selected, onChange }: RibbonRailProps) {
  const T = useTheme();
  const allActive = selected.length === 0;
  // The drop-in is the rail's entrance, not the ribbons': a rail that swaps its
  // type set (the Bookmarks and Tags segments share one) keeps hanging still.
  const hung = useRef(false);
  const drop = !hung.current;
  useEffect(() => {
    hung.current = true;
  }, []);
  const toggle = (type: UrnType) => {
    onChange(selected.includes(type) ? selected.filter((t) => t !== type) : [...selected, type]);
  };

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      decelerationRate="fast"
      style={styles.rail}
      contentContainerStyle={styles.railContent}
      accessibilityLabel="Filter by type"
    >
      <Ribbon
        active={allActive}
        color={T.accent}
        label="All"
        icon={<BookmarkSimple size={14} color={T.accent} weight="duotone" />}
        activeIcon={<BookmarkSimple size={14} color="#ffffff" weight="fill" />}
        index={0}
        drop={drop}
        onPress={() => onChange([])}
      />
      {types.map((type, i) => {
        const config = LIBRARY_TYPES[type];
        const color = libraryTypeColor(type) ?? T.accent;
        const Icon = config.icon;
        return (
          <Ribbon
            key={type}
            active={selected.includes(type)}
            color={color}
            label={config.labelPlural}
            icon={<Icon size={14} color={color} weight="duotone" />}
            activeIcon={<Icon size={14} color="#ffffff" weight="duotone" />}
            index={i + 1}
            drop={drop}
            onPress={() => toggle(type)}
          />
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  rail: { flexGrow: 0 },
  railContent: {
    paddingHorizontal: 16,
    paddingBottom: 6,
    gap: RAIL_GAP,
    alignItems: "flex-start",
  },
  ribbon: { alignItems: "center", gap: 6, width: RIBBON_W },
  body: { width: RIBBON_W, height: ACTIVE_H },
  activeShadow: {
    shadowOpacity: 0.55,
    shadowRadius: 11,
    shadowOffset: { width: 0, height: 10 },
  },
  iconSlot: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: ICON_LIFT,
    alignItems: "center",
  },
  iconOverlay: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, alignItems: "center" },
  label: {
    width: RIBBON_W + RAIL_GAP,
    textAlign: "center",
    fontSize: 8,
    fontFamily: FONT.semibold,
    letterSpacing: 0.9,
  },
});
