import React from "react";
import { StyleSheet, Text, View } from "react-native";
import {
  CheckCircle,
  HourglassHigh,
  Lock,
  PaperPlaneTilt,
  XCircle,
  type IconProps,
} from "phosphor-react-native";
import { useTheme } from "@shared/hooks/useTheme";
import { FONT } from "@theme/typography";
import type { SerializedTimesheetStatus } from "@features/projects/timeSerializer";
import type { SheetTone } from "@features/projects/timesheetStatus";

interface ChipState {
  status: SerializedTimesheetStatus;
  locked?: boolean;
  periodClosed?: boolean;
}

function StatusIcon({ status, locked, periodClosed, ...props }: IconProps & ChipState) {
  if (periodClosed || (locked && status === "open")) return <Lock {...props} />;
  if (status === "approved") return <CheckCircle {...props} />;
  if (status === "submitted") return <PaperPlaneTilt {...props} />;
  if (status === "rejected") return <XCircle {...props} />;
  return <HourglassHigh {...props} />;
}

export function useToneColor(): (tone: SheetTone) => string {
  const T = useTheme();
  const colors: Record<SheetTone, string> = {
    default: T.textDim,
    info: T.accent,
    success: T.green,
    warning: T.yellow,
    danger: T.red,
  };
  return (tone) => colors[tone];
}

/** A sheet's state as a tinted pill with its icon. */
export function SheetStatusChip({
  label,
  tone,
  small = false,
  testID,
  ...state
}: ChipState & { label: string; tone: SheetTone; small?: boolean; testID?: string }) {
  const color = useToneColor()(tone);
  return (
    <View
      style={[styles.chip, small && styles.small, { backgroundColor: color + "22" }]}
      testID={testID}
    >
      <StatusIcon {...state} size={small ? 11 : 13} color={color} weight="bold" />
      <Text style={[styles.text, small && styles.smallText, { color }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    borderRadius: 999,
    paddingHorizontal: 9,
    paddingVertical: 4,
  },
  small: { paddingHorizontal: 7, paddingVertical: 2 },
  text: { fontSize: 12, fontFamily: FONT.semibold },
  smallText: { fontSize: 11 },
});
