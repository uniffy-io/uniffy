import React from "react";
import { View, Text, TouchableOpacity, StyleSheet } from "react-native";
import { AirplaneTilt, Clock, EyeSlash } from "phosphor-react-native";
import type { IconProps } from "phosphor-react-native";
import { useTheme } from "@shared/hooks/useTheme";
import { FONT } from "@theme/typography";
import type {
  EventStatusValue,
  EventTransparencyValue,
  EventVisibilityValue,
} from "@features/calendar/calendarSerializer";

export interface EventStateValue {
  status: EventStatusValue;
  visibility: EventVisibilityValue;
  transparency: EventTransparencyValue;
  isOutOfOffice: boolean;
}

const STATUS_OPTIONS: { value: EventStatusValue; label: string }[] = [
  { value: "confirmed", label: "Confirmed" },
  { value: "tentative", label: "Tentative" },
  { value: "cancelled", label: "Cancelled" },
];

export function EventStateOptions({
  value,
  onChange,
}: {
  value: EventStateValue;
  onChange: (next: EventStateValue) => void;
}) {
  const T = useTheme();

  const toggles: {
    key: string;
    Icon: React.ComponentType<IconProps>;
    label: string;
    hint: string;
    active: boolean;
    flip: () => void;
  }[] = [
    {
      key: "private",
      Icon: EyeSlash,
      label: "Private",
      hint: "Others see only a busy block",
      active: value.visibility === "private",
      flip: () =>
        onChange({
          ...value,
          visibility: value.visibility === "private" ? "standard" : "private",
        }),
    },
    {
      key: "free",
      Icon: Clock,
      label: "Free",
      hint: "Does not block time",
      active: value.transparency === "transparent",
      flip: () =>
        onChange({
          ...value,
          transparency: value.transparency === "transparent" ? "opaque" : "transparent",
        }),
    },
    {
      key: "ooo",
      Icon: AirplaneTilt,
      label: "Out of office",
      hint: "Reads distinctly to colleagues",
      active: value.isOutOfOffice,
      flip: () => onChange({ ...value, isOutOfOffice: !value.isOutOfOffice }),
    },
  ];

  return (
    <View style={styles.container}>
      <View style={styles.statusRow}>
        {STATUS_OPTIONS.map((option) => {
          const active = value.status === option.value;
          const accent = option.value === "cancelled" ? T.red : T.accent;
          return (
            <TouchableOpacity
              key={option.value}
              style={[
                styles.statusChip,
                {
                  borderColor: active ? accent : T.border,
                  backgroundColor: active ? accent + "18" : "transparent",
                },
              ]}
              onPress={() => onChange({ ...value, status: option.value })}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityLabel={`Status: ${option.label}`}
            >
              <Text style={[styles.statusChipText, { color: active ? accent : T.textDim }]}>
                {option.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
      {value.status === "cancelled" ? (
        <Text style={[styles.cancelledHint, { color: T.textDim }]}>
          Cancelled events stay visible to attendees and stop blocking time.
        </Text>
      ) : null}

      {toggles.map(({ key, Icon, label, hint, active, flip }) => (
        <TouchableOpacity
          key={key}
          style={styles.toggleRow}
          onPress={flip}
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityLabel={`${label}: ${active ? "on" : "off"}`}
        >
          <Icon size={16} color={T.textDim} weight="duotone" />
          <View
            style={[
              styles.radioDot,
              { borderColor: active ? T.accent : T.textDim },
              active && { backgroundColor: T.accent },
            ]}
          />
          <Text style={[styles.toggleLabel, { color: T.textBright }]}>{label}</Text>
          <Text style={[styles.toggleHint, { color: T.textDim }]}>{hint}</Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    gap: 8,
  },
  statusRow: {
    flexDirection: "row",
    gap: 8,
  },
  statusChip: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 9,
    borderWidth: 1,
  },
  statusChipText: { fontSize: 13, fontFamily: FONT.medium },
  cancelledHint: { fontSize: 12, fontFamily: FONT.regular, lineHeight: 16 },
  toggleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 7,
  },
  radioDot: {
    width: 14,
    height: 14,
    borderRadius: 7,
    borderWidth: 2,
  },
  toggleLabel: { fontSize: 14, fontFamily: FONT.medium },
  toggleHint: { fontSize: 12, fontFamily: FONT.regular, marginLeft: "auto" },
});
