import React from "react";
import { Platform, StyleSheet, TouchableOpacity } from "react-native";
import type { StyleProp, ViewStyle } from "react-native";
import * as Haptics from "expo-haptics";
import { useTheme } from "@shared/hooks/useTheme";

export function tick() {
  if (Platform.OS === "web") return;
  Haptics.selectionAsync().catch(() => {});
}

// Full size is a flat circle so six of them fit any phone width; compact is the
// bordered dock button, kept round for contrast against chat content.
export function ControlButton({
  onPress,
  onLongPress,
  compact = false,
  disabled = false,
  selected,
  activeOpacity = 0.7,
  style,
  accessibilityLabel,
  accessibilityHint,
  children,
}: {
  onPress: () => void;
  onLongPress?: () => void;
  compact?: boolean;
  disabled?: boolean;
  /** Toggles that stay on (raised hand, open chat) sit on the accent tint. */
  selected?: boolean;
  activeOpacity?: number;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel: string;
  accessibilityHint?: string;
  children: React.ReactNode;
}) {
  const T = useTheme();
  return (
    <TouchableOpacity
      style={[
        styles.button,
        compact && [styles.compact, { backgroundColor: T.surface, borderColor: T.border }],
        selected && { backgroundColor: T.accentSoft },
        disabled && styles.disabled,
        style,
      ]}
      onPress={() => {
        tick();
        onPress();
      }}
      onLongPress={onLongPress}
      disabled={disabled}
      activeOpacity={activeOpacity}
      // The dock button is drawn at 36pt; the slop brings its target to 44.
      hitSlop={compact ? 4 : undefined}
      accessibilityRole="button"
      accessibilityState={{ disabled, selected }}
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
    >
      {children}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  button: {
    width: 46,
    height: 46,
    borderRadius: 23,
    alignItems: "center",
    justifyContent: "center",
  },
  compact: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
  },
  disabled: { opacity: 0.4 },
});
