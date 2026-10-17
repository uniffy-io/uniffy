import React from "react";
import { Alert, Pressable, StyleSheet, Text, View } from "react-native";
import { useTheme } from "@shared/hooks/useTheme";
import { FONT } from "@theme/typography";
import type { ThemeColors } from "@theme/theme";
import type { PersistenceState } from "@shared/realtime/persistenceState";

interface ChipCopy {
  label: string;
  title: string;
  dot: keyof ThemeColors;
  alert?: boolean;
}

const COPY: Record<PersistenceState, ChipCopy> = {
  saved: { label: "Saved", title: "All your edits are saved.", dot: "green" },
  synced: { label: "Synced", title: "Shared with collaborators, saving shortly.", dot: "textDim" },
  syncing: { label: "Syncing", title: "Sending your latest edits.", dot: "textDim" },
  unavailable: {
    label: "Saving unavailable",
    title: "Your edits stay on this device. Saving resumes automatically.",
    dot: "orange",
  },
  delayed: {
    label: "Saving delayed",
    title:
      "Saving is taking longer than usual. Your edits stay on this device until they are saved.",
    dot: "orange",
  },
  connecting: { label: "Connecting", title: "Connecting to live editing.", dot: "textDim" },
  offline: {
    label: "Offline",
    title: "Edits stay on this device and sync when the connection returns.",
    dot: "textDim",
  },
  storage_failed: {
    label: "Not saved on device",
    title:
      "This device could not store your latest edits. Keep this editor open until it shows Saved.",
    dot: "red",
    alert: true,
  },
  rejected: {
    label: "Edit not synced",
    title:
      "This edit could not be synced. Your local draft is kept. Very large edits must be smaller to sync.",
    dot: "red",
    alert: true,
  },
  view_only: {
    label: "View-only",
    title: "You can read this item but not edit it.",
    dot: "red",
    alert: true,
  },
  access_lost: {
    label: "Access lost",
    title: "This item was deleted or is no longer shared with you.",
    dot: "red",
    alert: true,
  },
  session_ended: {
    label: "Session ended",
    title: "Sign in again to keep editing.",
    dot: "red",
    alert: true,
  },
  upgrade_required: {
    label: "Update to keep saving",
    title: "This version of Uniffy can no longer save edits. Update the app to keep saving.",
    dot: "red",
    alert: true,
  },
};

/** Save state of a live document. Static on purpose: routine saves never flash or announce. */
export function PersistenceChip({ state }: { state: PersistenceState }) {
  const T = useTheme();
  const { label, title, dot, alert } = COPY[state];
  return (
    <Pressable
      onPress={() => Alert.alert(label, title)}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={title}
      accessibilityLiveRegion={alert ? "polite" : "none"}
      style={[
        styles.chip,
        {
          backgroundColor: alert ? T.red + "18" : T.surface,
          borderColor: alert ? T.red + "55" : T.border,
        },
      ]}
    >
      <View style={[styles.dot, { backgroundColor: T[dot] }]} />
      <Text numberOfLines={1} style={[styles.label, { color: alert ? T.red : T.textDim }]}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    maxWidth: "100%",
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  label: {
    flexShrink: 1,
    fontSize: 12,
    fontFamily: FONT.medium,
  },
});
