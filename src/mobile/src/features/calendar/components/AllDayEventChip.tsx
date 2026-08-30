import React from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { AirplaneTilt } from "phosphor-react-native";
import { useTheme } from "@shared/hooks/useTheme";
import { FONT } from "@theme/typography";
import { eventDisplayState } from "@features/calendar/eventDisplay";
import type { SerializedEvent } from "@features/calendar/calendarSerializer";

/**
 * The chip both grids pin above their scrolling canvas for all-day events, so
 * a banner spanning a week reads exactly like the same event in the day view.
 * The compact variant is sized by the caller and drops the trailing label,
 * which the week's own gutter already carries.
 */
export function AllDayEventChip({
  event,
  color,
  live,
  onPress,
  compact = false,
  showAllDayLabel = false,
  style,
}: {
  event: SerializedEvent;
  color: string;
  live: boolean;
  onPress: () => void;
  compact?: boolean;
  showAllDayLabel?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const T = useTheme();
  const display = eventDisplayState(event);

  return (
    <TouchableOpacity
      style={[
        styles.chip,
        compact ? styles.chipCompact : styles.chipRoomy,
        (display.cancelled || display.tentative) && styles.faded,
        { backgroundColor: color + (display.free ? "1A" : "33"), borderColor: color },
        style,
      ]}
      onPress={onPress}
      activeOpacity={0.85}
    >
      {display.outOfOffice ? (
        <AirplaneTilt size={compact ? 10 : 12} color={T.textDim} weight="duotone" />
      ) : null}
      {live ? (
        <View
          style={[compact ? styles.liveDotCompact : styles.liveDot, { backgroundColor: T.red }]}
        />
      ) : null}
      <Text
        style={[
          compact ? styles.titleCompact : styles.title,
          { color: T.textBright },
          display.cancelled && styles.struck,
        ]}
        numberOfLines={1}
      >
        {display.title}
      </Text>
      {showAllDayLabel ? (
        <Text style={[styles.allDayLabel, { color: T.textDim }]}>All day</Text>
      ) : null}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  chip: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    overflow: "hidden",
  },
  chipRoomy: {
    gap: 6,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  chipCompact: {
    gap: 4,
    borderRadius: 7,
    paddingHorizontal: 7,
  },
  faded: { opacity: 0.65 },
  title: { fontSize: 13, fontFamily: FONT.semibold, flexShrink: 1 },
  titleCompact: { fontSize: 11, fontFamily: FONT.medium, flexShrink: 1 },
  struck: { textDecorationLine: "line-through" },
  allDayLabel: { fontSize: 12, fontFamily: FONT.semibold },
  liveDot: { width: 7, height: 7, borderRadius: 3.5 },
  liveDotCompact: { width: 6, height: 6, borderRadius: 3 },
});
