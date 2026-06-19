import React from "react";
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, Platform } from "react-native";
import { Sun, Moon, DeviceMobile, Check, CaretLeft } from "phosphor-react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router } from "expo-router";
import { useTheme } from "@/hooks/useTheme";
import { useThemeContext } from "@/context/theme-context";
import type { ThemeMode } from "@/context/theme-context";
import { hslToHex } from "@/lib/colorUtils";
import { BOTTOM_NAV_HEIGHT, DEFAULT_ACCENT_HSL } from "@/constants/theme";

const THEME_MODES: { key: ThemeMode; label: string; Icon: typeof Sun }[] = [
  { key: "light", label: "Light", Icon: Sun },
  { key: "dark", label: "Dark", Icon: Moon },
  { key: "system", label: "System", Icon: DeviceMobile },
];

const ACCENT_PRESETS = [
  { name: "Blue", hsl: "217 91% 60%" },
  { name: "Purple", hsl: "262.1 83.3% 57.8%" },
  { name: "Green", hsl: "142.1 76.2% 36.3%" },
  { name: "Orange", hsl: "24.6 95% 53.1%" },
  { name: "Red", hsl: "0 84.2% 60.2%" },
  { name: "Pink", hsl: "330 81% 60%" },
  { name: "Teal", hsl: "174 72% 40%" },
  { name: "Amber", hsl: "38 92% 50%" },
];

export function AppearanceScreen() {
  const T = useTheme();
  const { themeMode, accentColorHsl, setThemeMode, setAccentColor } = useThemeContext();
  const insets = useSafeAreaInsets();
  const bottomPad =
    Platform.OS === "web" ? BOTTOM_NAV_HEIGHT + 34 : BOTTOM_NAV_HEIGHT + insets.bottom;

  const currentAccentHsl = accentColorHsl ?? DEFAULT_ACCENT_HSL;

  return (
    <View style={[styles.container, { backgroundColor: T.pageBg }]}>
      <View style={[styles.header, { backgroundColor: T.bg, borderBottomColor: T.border }]}>
        <TouchableOpacity
          onPress={() => router.back()}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <CaretLeft size={22} color={T.textBright} weight="regular" />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: T.textBright }]}>Appearance</Text>
        <View style={{ width: 22 }} />
      </View>

      <ScrollView
        contentContainerStyle={{ paddingBottom: bottomPad }}
        showsVerticalScrollIndicator={false}
      >
        {/* Theme Mode */}
        <View style={styles.section}>
          <Text style={[styles.sectionLabel, { color: T.textDim }]}>THEME</Text>
          <View style={styles.modeRow}>
            {THEME_MODES.map(({ key, label, Icon }) => {
              const active = themeMode === key;
              return (
                <TouchableOpacity
                  key={key}
                  style={[
                    styles.modeCard,
                    {
                      backgroundColor: T.surface,
                      borderColor: active ? T.accent : T.border,
                      borderWidth: active ? 2 : StyleSheet.hairlineWidth,
                    },
                  ]}
                  onPress={() => setThemeMode(key)}
                  activeOpacity={0.7}
                >
                  <Icon
                    size={22}
                    color={active ? T.accent : T.textDim}
                    weight={active ? "fill" : "regular"}
                  />
                  <Text style={[styles.modeLabel, { color: active ? T.accent : T.textBright }]}>
                    {label}
                  </Text>
                  {active && (
                    <View style={[styles.checkCircle, { backgroundColor: T.accent }]}>
                      <Check size={10} color="#fff" weight="bold" />
                    </View>
                  )}
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        {/* Accent Color */}
        <View style={styles.section}>
          <Text style={[styles.sectionLabel, { color: T.textDim }]}>ACCENT COLOR</Text>
          <View style={[styles.colorGrid, { backgroundColor: T.surface, borderColor: T.border }]}>
            {ACCENT_PRESETS.map((preset) => {
              const hex = hslToHex(preset.hsl);
              const active = currentAccentHsl === preset.hsl;
              return (
                <TouchableOpacity
                  key={preset.name}
                  style={styles.colorItem}
                  onPress={() => setAccentColor(preset.hsl)}
                  activeOpacity={0.7}
                >
                  <View
                    style={[
                      styles.colorCircle,
                      {
                        backgroundColor: hex,
                        borderWidth: active ? 3 : 0,
                        borderColor: active ? T.textBright : "transparent",
                      },
                    ]}
                  >
                    {active && <Check size={16} color="#fff" weight="bold" />}
                  </View>
                  <Text style={[styles.colorName, { color: active ? T.textBright : T.textDim }]}>
                    {preset.name}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        {/* Preview */}
        <View style={styles.section}>
          <Text style={[styles.sectionLabel, { color: T.textDim }]}>PREVIEW</Text>
          <View style={[styles.previewCard, { backgroundColor: T.surface, borderColor: T.border }]}>
            <View style={[styles.previewAccent, { backgroundColor: T.accent }]}>
              <Text style={styles.previewAccentText}>Accent</Text>
            </View>
            <View style={[styles.previewSoft, { backgroundColor: T.accentSoft }]}>
              <Text style={[styles.previewSoftText, { color: T.accent }]}>Soft</Text>
            </View>
            <Text style={[styles.previewLabel, { color: T.textBright }]}>
              This is how your accent color looks across the app.
            </Text>
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerTitle: {
    fontSize: 16,
    fontFamily: "Inter_600SemiBold",
  },
  section: {
    paddingHorizontal: 16,
    paddingTop: 24,
    gap: 10,
  },
  sectionLabel: {
    fontSize: 11,
    fontFamily: "Inter_600SemiBold",
    letterSpacing: 0.8,
  },
  modeRow: {
    flexDirection: "row",
    gap: 10,
  },
  modeCard: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 18,
    borderRadius: 12,
    gap: 8,
  },
  modeLabel: {
    fontSize: 13,
    fontFamily: "Inter_500Medium",
  },
  checkCircle: {
    position: "absolute",
    top: 8,
    right: 8,
    width: 18,
    height: 18,
    borderRadius: 9,
    alignItems: "center",
    justifyContent: "center",
  },
  colorGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 16,
    gap: 16,
  },
  colorItem: {
    alignItems: "center",
    gap: 6,
    width: 60,
  },
  colorCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  colorName: {
    fontSize: 11,
    fontFamily: "Inter_500Medium",
  },
  previewCard: {
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 16,
    gap: 12,
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
  },
  previewAccent: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
  },
  previewAccentText: {
    color: "#fff",
    fontSize: 13,
    fontFamily: "Inter_600SemiBold",
  },
  previewSoft: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
  },
  previewSoftText: {
    fontSize: 13,
    fontFamily: "Inter_600SemiBold",
  },
  previewLabel: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    flex: 1,
    minWidth: 150,
  },
});
