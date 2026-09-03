import React, { useEffect } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withTiming,
} from "react-native-reanimated";
import { BookmarkSimple, LinkBreak } from "phosphor-react-native";
import { useTheme } from "@shared/hooks/useTheme";
import { FONT } from "@theme/typography";
import { withAlpha } from "@theme/brandRamp";
import type { UrnType } from "@shared/lib/contentTypes";
import { LIBRARY_TYPES, libraryTypeColor } from "@features/library/libraryTypes";

export interface LibraryCardItem {
  key: string;
  urn: string;
  type: UrnType | null;
  title: string;
  /** Where the item lives or came from, shown before the type label. */
  context: string;
  /** Overrides the type's own label, e.g. "Folder" for a folder note. */
  typeLabel?: string;
  snippet: string;
  age: string;
  route: string | null;
  unavailable?: "deleted" | "unavailable";
}

const ENTER_MS = 400;
const STAGGER_MS = 25;
// Only the first screenful cascades; rows mounting on scroll appear at once.
const STAGGER_CAP = 8;
const ICON_BOX = 26;
const PAD = 12;
const GAP = 10;
// The snippet starts under the title, not under the icon.
const TEXT_INSET = PAD + ICON_BOX + GAP;

interface LibraryCardProps {
  item: LibraryCardItem;
  index: number;
  onPress: () => void;
  /** Bookmark cards: unsave. Absent on a tag's content. */
  onRemove?: () => void;
}

export function LibraryCard({ item, index, onPress, onRemove }: LibraryCardProps) {
  const T = useTheme();
  const reducedMotion = useReducedMotion();
  const entered = useSharedValue(reducedMotion ? 1 : 0);

  useEffect(() => {
    if (reducedMotion) return;
    entered.value = withDelay(
      index < STAGGER_CAP ? index * STAGGER_MS : 0,
      withTiming(1, { duration: ENTER_MS, easing: Easing.out(Easing.quad) }),
    );
  }, [entered, index, reducedMotion]);

  const enterStyle = useAnimatedStyle(() => ({
    opacity: entered.value,
    transform: [{ translateY: (1 - entered.value) * 10 }, { scale: 0.985 + entered.value * 0.015 }],
  }));

  const unavailable = item.unavailable;
  const color = (!unavailable && libraryTypeColor(item.type)) || T.textDim;
  const config = item.type ? LIBRARY_TYPES[item.type] : null;
  const Icon = unavailable || !config ? LinkBreak : config.icon;
  const typeLabel = item.typeLabel ?? config?.label ?? "Item";
  const title = unavailable
    ? unavailable === "deleted"
      ? "This item was deleted"
      : "This item is unavailable"
    : item.title;

  return (
    <Animated.View style={[styles.wrap, enterStyle]}>
      <Pressable
        onPress={onPress}
        disabled={!item.route}
        accessibilityRole={item.route ? "link" : undefined}
        style={({ pressed }) => [
          styles.card,
          {
            backgroundColor: T.surface,
            borderColor: pressed && item.route ? withAlpha(T.accent, 0.4) : T.border,
          },
        ]}
      >
        <View style={styles.head}>
          <View
            style={[
              styles.iconBox,
              { borderColor: withAlpha(color, 0.55), backgroundColor: withAlpha(color, 0.1) },
            ]}
          >
            <Icon size={15} color={color} weight="duotone" />
          </View>
          <View style={styles.titleBlock}>
            <Text
              style={[
                styles.title,
                { color: unavailable ? T.textDim : T.textBright },
                unavailable && styles.unavailableTitle,
              ]}
              numberOfLines={1}
            >
              {title}
            </Text>
            <View style={styles.metaRow}>
              {!unavailable && item.context ? (
                <>
                  <Text style={[styles.context, { color: T.textDim }]} numberOfLines={1}>
                    {item.context}
                  </Text>
                  <Text style={[styles.context, { color: T.textDim }]}>·</Text>
                </>
              ) : null}
              {!unavailable ? <Text style={[styles.typeLabel, { color }]}>{typeLabel}</Text> : null}
              {item.age ? (
                <>
                  {!unavailable ? (
                    <Text style={[styles.context, { color: T.textDim }]}>·</Text>
                  ) : null}
                  <Text style={[styles.age, { color: T.textDim }]}>{item.age}</Text>
                </>
              ) : null}
            </View>
          </View>
          {onRemove ? (
            unavailable ? (
              <Pressable onPress={onRemove} hitSlop={8} accessibilityLabel="Remove bookmark">
                <Text style={[styles.removeText, { color: T.textDim }]}>Remove</Text>
              </Pressable>
            ) : (
              <Pressable
                onPress={onRemove}
                hitSlop={10}
                accessibilityLabel="Remove bookmark"
                style={styles.remove}
              >
                <BookmarkSimple size={16} color={T.accent} weight="fill" />
              </Pressable>
            )
          ) : null}
        </View>

        {!unavailable && item.snippet ? (
          <Text style={[styles.snippet, { color: T.textDim }]} numberOfLines={1}>
            {item.snippet}
          </Text>
        ) : null}
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: 16, paddingBottom: 8 },
  card: {
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: "hidden",
  },
  head: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: GAP,
    paddingHorizontal: PAD,
    paddingTop: 9,
    paddingBottom: 9,
  },
  iconBox: {
    width: ICON_BOX,
    height: ICON_BOX,
    borderRadius: 7,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  titleBlock: { flex: 1, minWidth: 0 },
  title: { fontSize: 14, fontFamily: FONT.semibold },
  unavailableTitle: { fontSize: 13, fontFamily: FONT.regular, fontStyle: "italic" },
  metaRow: { flexDirection: "row", alignItems: "center", gap: 5 },
  context: { fontSize: 11, fontFamily: FONT.regular, flexShrink: 1 },
  typeLabel: { fontSize: 10, fontFamily: FONT.medium },
  remove: { padding: 2 },
  // Pulled up under the meta row; the head's bottom padding is the card's.
  snippet: {
    fontSize: 12,
    fontFamily: FONT.regular,
    paddingLeft: TEXT_INSET,
    paddingRight: PAD,
    marginTop: -9,
    paddingBottom: 9,
  },
  age: { fontSize: 11, fontFamily: FONT.regular },
  removeText: { fontSize: 12, fontFamily: FONT.medium, paddingHorizontal: 2 },
});
