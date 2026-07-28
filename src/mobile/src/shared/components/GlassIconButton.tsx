import React from "react";
import { Pressable, StyleSheet } from "react-native";
import type { ColorValue, StyleProp, ViewStyle } from "react-native";
import { GlassSurface } from "@shared/components/GlassSurface";
import { useTheme } from "@shared/hooks/useTheme";

type GlassIconButtonProps = {
  onPress: () => void;
  accessibilityLabel: string;
  children: React.ReactNode;
  size?: number;
  style?: StyleProp<ViewStyle>;
  /** Android/web fallback fill. Defaults to the opaque theme surface; pass a
   * semi-transparent value to let content scroll behind the button. */
  solidColor?: ColorValue;
};

// A separated, pill-shaped liquid-glass action button for headers and
// overlays. Degrades through GlassSurface: liquid glass on iOS 26, system blur
// on older iOS, a solid themed pill on Android/web. minWidth keeps a single
// icon circular while a wider child (icon + count) grows into a pill.
export function GlassIconButton({
  onPress,
  accessibilityLabel,
  children,
  size = 36,
  style,
  solidColor,
}: GlassIconButtonProps) {
  const T = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      hitSlop={8}
      style={[
        styles.button,
        {
          minWidth: size,
          height: size,
          borderRadius: size / 2,
          borderColor: T.isDark ? "rgba(255,255,255,0.14)" : "rgba(0,0,0,0.08)",
        },
        style,
      ]}
    >
      <GlassSurface
        style={StyleSheet.absoluteFill}
        tintColor={T.isDark ? "rgba(20,22,34,0.22)" : "rgba(255,255,255,0.35)"}
        interactive
        isDark={T.isDark}
        blurIntensity={40}
        solidColor={solidColor ?? T.surface}
      />
      {children}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 3,
    paddingHorizontal: 6,
    overflow: "hidden",
    borderWidth: StyleSheet.hairlineWidth,
  },
});
