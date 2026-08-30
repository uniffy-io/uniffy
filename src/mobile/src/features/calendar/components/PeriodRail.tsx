import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  TouchableOpacity,
  useWindowDimensions,
  type ListRenderItemInfo,
} from "react-native";
import * as Haptics from "expo-haptics";
import { useTheme } from "@shared/hooks/useTheme";
import { FONT } from "@theme/typography";
import type { WeekStartDay } from "@core/datetimePrefs";
import {
  buildRailItems,
  railAccessibilityLabel,
  railKeyFor,
  railPinnedLabel,
  railUnitFor,
  railWidths,
  railAnchorKey,
  type RailItem,
  type RailUnit,
} from "@features/calendar/periodRail";

type ViewMode = "day" | "week" | "month" | "agenda";

export function PeriodRail({
  viewMode,
  selectedDate,
  currentMonth,
  today,
  weekStartsOn,
  onSelect,
}: {
  viewMode: ViewMode;
  selectedDate: Date;
  currentMonth: Date;
  today: Date;
  weekStartsOn: WeekStartDay;
  onSelect: (item: RailItem) => void;
}) {
  const T = useTheme();
  const { fontScale } = useWindowDimensions();
  const listRef = useRef<FlatList<RailItem>>(null);
  const centredOnce = useRef(false);
  const [listWidth, setListWidth] = useState(0);
  const [leadingLabel, setLeadingLabel] = useState<string | null>(null);

  const unit = railUnitFor(viewMode);
  const activeDate = viewMode === "month" ? currentMonth : selectedDate;
  const activeKey = railKeyFor(unit, activeDate, weekStartsOn);

  const anchorKey = railAnchorKey(unit, activeDate, weekStartsOn);
  const items = useMemo(
    () => buildRailItems({ unit, anchorKey, today, weekStartsOn, fontScale }),
    [unit, anchorKey, today, weekStartsOn, fontScale],
  );
  const selectedIndex = useMemo(
    () => items.findIndex((i) => i.key === activeKey),
    [items, activeKey],
  );

  useEffect(() => {
    if (listWidth === 0 || selectedIndex === -1) return;
    const item = items[selectedIndex];
    listRef.current?.scrollToOffset({
      offset: Math.max(0, item.offset + item.width / 2 - listWidth / 2),
      animated: centredOnce.current,
    });
    centredOnce.current = true;
  }, [items, selectedIndex, listWidth]);

  // The pinned label names the leftmost pill, so scrubbing into another month
  // or year says so before anything is selected.
  const onScroll = useCallback(
    (x: number) => {
      const leading = items.find((i) => i.offset + i.width > x) ?? items[0];
      if (leading) {
        const next = railPinnedLabel(unit, leading.date, today.getFullYear());
        setLeadingLabel((prev) => (prev === next ? prev : next));
      }
    },
    [items, unit, today],
  );

  const press = useCallback(
    (item: RailItem) => {
      Haptics.selectionAsync().catch(() => {});
      onSelect(item);
    },
    [onSelect],
  );

  const renderItem = useCallback(
    ({ item }: ListRenderItemInfo<RailItem>) => (
      <RailPill
        item={item}
        unit={unit}
        selected={item.key === activeKey}
        fontScale={fontScale}
        onPress={press}
      />
    ),
    [unit, activeKey, fontScale, press],
  );

  return (
    <View style={[styles.rail, { backgroundColor: T.surface, borderBottomColor: T.border }]}>
      <View style={styles.pinnedBox}>
        <Text style={[styles.pinnedLabel, { color: T.textDim }]}>
          {leadingLabel ?? railPinnedLabel(unit, activeDate, today.getFullYear())}
        </Text>
      </View>
      <View style={[styles.pinnedDivider, { backgroundColor: T.textDim }]} />
      <View style={styles.listBox} onLayout={(e) => setListWidth(e.nativeEvent.layout.width)}>
        <FlatList
          ref={listRef}
          data={items}
          horizontal
          showsHorizontalScrollIndicator={false}
          keyExtractor={(item) => item.key}
          renderItem={renderItem}
          getItemLayout={(data, index) => ({
            length: data?.[index]?.width ?? 0,
            offset: data?.[index]?.offset ?? 0,
            index,
          })}
          initialScrollIndex={selectedIndex > 0 ? selectedIndex : undefined}
          onScroll={(e) => onScroll(e.nativeEvent.contentOffset.x)}
          scrollEventThrottle={32}
          initialNumToRender={16}
          maxToRenderPerBatch={12}
          windowSize={5}
          removeClippedSubviews
        />
      </View>
    </View>
  );
}

const RailPill = React.memo(function RailPill({
  item,
  unit,
  selected,
  fontScale,
  onPress,
}: {
  item: RailItem;
  unit: RailUnit;
  selected: boolean;
  fontScale: number;
  onPress: (item: RailItem) => void;
}) {
  const T = useTheme();
  const widths = railWidths(unit, fontScale);
  const accent = selected ? "#fff" : item.isToday ? T.accent : T.textBright;

  return (
    <View style={[styles.itemRow, { marginRight: widths.gap }]}>
      {item.marker ? (
        <Text style={[styles.marker, { width: item.markerWidth, color: T.textDim }]}>
          {item.marker}
        </Text>
      ) : null}
      <TouchableOpacity
        style={[
          styles.pill,
          {
            width: widths.pill,
            borderColor: selected || item.isToday ? T.accent : T.border,
            backgroundColor: selected ? T.accent : "transparent",
          },
        ]}
        onPress={() => onPress(item)}
        activeOpacity={0.8}
        accessibilityRole="button"
        accessibilityState={{ selected }}
        accessibilityLabel={railAccessibilityLabel(unit, item)}
      >
        <Text style={[styles.primary, { color: accent }]} numberOfLines={1}>
          {item.primary}
        </Text>
      </TouchableOpacity>
    </View>
  );
});

const styles = StyleSheet.create({
  rail: {
    flexDirection: "row",
    alignItems: "center",
    paddingLeft: 12,
    paddingVertical: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  pinnedBox: { justifyContent: "center", paddingRight: 10 },
  pinnedDivider: { width: 1, alignSelf: "stretch", marginRight: 10, opacity: 0.75 },
  pinnedLabel: { fontSize: 11, fontFamily: FONT.semibold },
  listBox: { flex: 1 },
  itemRow: { flexDirection: "row", alignItems: "center" },
  marker: { fontSize: 11, fontFamily: FONT.semibold, textAlign: "center" },
  pill: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 4,
    borderRadius: 16,
    borderWidth: 1,
  },
  primary: { fontSize: 13, fontFamily: FONT.semibold },
});
