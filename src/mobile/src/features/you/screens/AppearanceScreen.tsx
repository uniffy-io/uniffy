import React, { useMemo, useState } from "react";
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  TextInput,
  StyleSheet,
  Platform,
} from "react-native";
import {
  Sun,
  Moon,
  DeviceMobile,
  Check,
  CaretDown,
  GlobeHemisphereWest,
} from "phosphor-react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { DomainHeader } from "@shared/components/DomainHeader";
import { BottomSheet } from "@shared/components/BottomSheet";
import { useTheme } from "@shared/hooks/useTheme";
import { useThemeContext } from "@core/providers/ThemeContext";
import type { ThemeMode } from "@core/providers/ThemeContext";
import { getDeviceTimeZone, useDateTimePrefs } from "@core/datetimePrefs";
import { useChatLayout, setChatLayout, type ChatLayout } from "@features/chat/chatPrefs";
import { hslToHex } from "@theme/colorUtils";
import { BOTTOM_NAV_HEIGHT, DEFAULT_ACCENT_HSL, ACCENT_PRESETS } from "@theme/theme";
import { FONT } from "@theme/typography";

const THEME_MODES: { key: ThemeMode; label: string; Icon: typeof Sun }[] = [
  { key: "light", label: "Light", Icon: Sun },
  { key: "dark", label: "Dark", Icon: Moon },
  { key: "system", label: "System", Icon: DeviceMobile },
];

const CHAT_LAYOUTS: { key: ChatLayout; label: string; hint: string }[] = [
  { key: "compact", label: "Compact", hint: "One column, everyone the same" },
  { key: "bubbles", label: "Bubbles", hint: "Your messages on the right" },
];

const WEEK_STARTS: { key: "monday" | "saturday" | "sunday"; label: string }[] = [
  { key: "monday", label: "Monday" },
  { key: "saturday", label: "Saturday" },
  { key: "sunday", label: "Sunday" },
];

// Curated common zones for engines without Intl.supportedValuesOf (Hermes on
// current devices). Every UTC offset region is represented; the full list
// appears automatically once the engine grows the API.
const FALLBACK_ZONES = [
  "Pacific/Honolulu",
  "America/Anchorage",
  "America/Los_Angeles",
  "America/Vancouver",
  "America/Denver",
  "America/Phoenix",
  "America/Chicago",
  "America/Mexico_City",
  "America/New_York",
  "America/Toronto",
  "America/Bogota",
  "America/Lima",
  "America/Caracas",
  "America/Santiago",
  "America/Sao_Paulo",
  "America/Argentina/Buenos_Aires",
  "Atlantic/Azores",
  "Europe/London",
  "Europe/Dublin",
  "Europe/Lisbon",
  "Europe/Madrid",
  "Europe/Paris",
  "Europe/Brussels",
  "Europe/Amsterdam",
  "Europe/Berlin",
  "Europe/Zurich",
  "Europe/Rome",
  "Europe/Vienna",
  "Europe/Prague",
  "Europe/Warsaw",
  "Europe/Stockholm",
  "Europe/Oslo",
  "Europe/Copenhagen",
  "Europe/Budapest",
  "Europe/Belgrade",
  "Europe/Athens",
  "Europe/Bucharest",
  "Europe/Sofia",
  "Europe/Helsinki",
  "Europe/Riga",
  "Europe/Vilnius",
  "Europe/Kyiv",
  "Europe/Istanbul",
  "Europe/Moscow",
  "Africa/Casablanca",
  "Africa/Lagos",
  "Africa/Cairo",
  "Africa/Johannesburg",
  "Africa/Nairobi",
  "Asia/Jerusalem",
  "Asia/Beirut",
  "Asia/Riyadh",
  "Asia/Dubai",
  "Asia/Tehran",
  "Asia/Baku",
  "Asia/Karachi",
  "Asia/Kolkata",
  "Asia/Kathmandu",
  "Asia/Dhaka",
  "Asia/Yangon",
  "Asia/Bangkok",
  "Asia/Jakarta",
  "Asia/Singapore",
  "Asia/Kuala_Lumpur",
  "Asia/Hong_Kong",
  "Asia/Shanghai",
  "Asia/Taipei",
  "Asia/Manila",
  "Asia/Seoul",
  "Asia/Tokyo",
  "Australia/Perth",
  "Australia/Adelaide",
  "Australia/Brisbane",
  "Australia/Sydney",
  "Australia/Melbourne",
  "Pacific/Auckland",
  "Pacific/Fiji",
];

// Not in every engine, and the type only lands in newer TS libs.
function listTimeZones(): string[] {
  const supported = (Intl as { supportedValuesOf?: (key: string) => string[] }).supportedValuesOf;
  try {
    const zones = supported ? supported("timeZone") : [];
    return zones.length > 0 ? zones : FALLBACK_ZONES;
  } catch {
    return FALLBACK_ZONES;
  }
}

function zoneLabel(zone: string): string {
  return zone.replace(/_/g, " ");
}

export function AppearanceScreen() {
  const T = useTheme();
  const {
    themeMode,
    accentColorHsl,
    setThemeMode,
    setAccentColor,
    setTimezonePref,
    setWeekStartPref,
  } = useThemeContext();
  const { preferredTimeZone, weekStartsOn } = useDateTimePrefs();
  const chatLayout = useChatLayout();
  const [zonePickerOpen, setZonePickerOpen] = useState(false);
  const [zoneQuery, setZoneQuery] = useState("");

  const zones = useMemo(() => {
    const list = listTimeZones().filter((z) => z !== "UTC");
    // A preference picked on web may not be in the curated fallback; keep it
    // visible so its check mark has a row to sit on.
    if (preferredTimeZone && !list.includes(preferredTimeZone)) list.unshift(preferredTimeZone);
    return list;
  }, [preferredTimeZone]);
  const filteredZones = useMemo(() => {
    const q = zoneQuery.trim().toLowerCase().replace(/ /g, "_");
    const matches = q ? zones.filter((z) => z.toLowerCase().includes(q)) : zones;
    return matches.slice(0, 60);
  }, [zones, zoneQuery]);

  const activeWeekStart =
    WEEK_STARTS.find((w) => ({ monday: 1, saturday: 6, sunday: 0 })[w.key] === weekStartsOn)?.key ??
    "monday";

  const pickZone = (zone: string | null) => {
    setZonePickerOpen(false);
    setZoneQuery("");
    setTimezonePref(zone);
  };
  const insets = useSafeAreaInsets();
  const bottomPad =
    Platform.OS === "web" ? BOTTOM_NAV_HEIGHT + 34 : BOTTOM_NAV_HEIGHT + insets.bottom;

  const currentAccentHsl = accentColorHsl ?? DEFAULT_ACCENT_HSL;

  return (
    <View style={[styles.container, { backgroundColor: T.pageBg }]}>
      <DomainHeader title="Appearance" color={T.accent} icon="palette" />

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
                    key={active ? "fill" : "regular"}
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

        {/* Chat Layout */}
        <View style={styles.section}>
          <Text style={[styles.sectionLabel, { color: T.textDim }]}>CHAT LAYOUT</Text>
          <View style={styles.modeRow}>
            {CHAT_LAYOUTS.map(({ key, label, hint }) => {
              const active = chatLayout === key;
              return (
                <TouchableOpacity
                  key={key}
                  style={[
                    styles.layoutCard,
                    {
                      backgroundColor: T.surface,
                      borderColor: active ? T.accent : T.border,
                      borderWidth: active ? 2 : StyleSheet.hairlineWidth,
                    },
                  ]}
                  onPress={() => setChatLayout(key)}
                  activeOpacity={0.7}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: active }}
                >
                  <LayoutSketch sided={key === "bubbles"} T={T} />
                  <Text style={[styles.modeLabel, { color: active ? T.accent : T.textBright }]}>
                    {label}
                  </Text>
                  <Text style={[styles.layoutHint, { color: T.textDim }]}>{hint}</Text>
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

        {/* Date & time */}
        <View style={styles.section}>
          <Text style={[styles.sectionLabel, { color: T.textDim }]}>DATE & TIME</Text>
          <TouchableOpacity
            style={[styles.zoneRow, { backgroundColor: T.surface, borderColor: T.border }]}
            onPress={() => setZonePickerOpen(true)}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel={`Timezone: ${preferredTimeZone ? zoneLabel(preferredTimeZone) : "Automatic"}. Change`}
          >
            <GlobeHemisphereWest size={18} color={T.textDim} weight="duotone" />
            <Text style={[styles.zoneRowLabel, { color: T.textBright }]}>Timezone</Text>
            <Text style={[styles.zoneRowValue, { color: T.textDim }]} numberOfLines={1}>
              {preferredTimeZone
                ? zoneLabel(preferredTimeZone)
                : `Automatic (${zoneLabel(getDeviceTimeZone())})`}
            </Text>
            <CaretDown size={14} color={T.textDim} weight="bold" />
          </TouchableOpacity>
          <View style={styles.modeRow}>
            {WEEK_STARTS.map(({ key, label }) => {
              const active = activeWeekStart === key;
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
                  onPress={() => setWeekStartPref(key)}
                  activeOpacity={0.7}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: active }}
                >
                  <Text style={[styles.modeLabel, { color: active ? T.accent : T.textBright }]}>
                    {label}
                  </Text>
                  <Text style={[styles.layoutHint, { color: T.textDim }]}>Week starts</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>
      </ScrollView>

      <BottomSheet visible={zonePickerOpen} onClose={() => setZonePickerOpen(false)}>
        <Text style={[styles.zoneSheetTitle, { color: T.textBright }]}>Timezone</Text>
        <View style={styles.zoneSearchWrap}>
          <TextInput
            style={[
              styles.zoneSearch,
              { color: T.textBright, backgroundColor: T.pageBg, borderColor: T.border },
            ]}
            value={zoneQuery}
            onChangeText={setZoneQuery}
            placeholder="Search timezones"
            placeholderTextColor={T.textDim}
            autoCapitalize="none"
            autoCorrect={false}
          />
        </View>
        <ScrollView style={styles.zoneList} keyboardShouldPersistTaps="handled">
          <TouchableOpacity
            style={[styles.zoneOption, { borderTopColor: T.border }]}
            onPress={() => pickZone(null)}
            activeOpacity={0.7}
          >
            <Text style={[styles.zoneOptionLabel, { color: T.textBright }]}>
              Automatic ({zoneLabel(getDeviceTimeZone())})
            </Text>
            {!preferredTimeZone && <Check size={16} color={T.accent} weight="bold" />}
          </TouchableOpacity>
          {filteredZones.map((zone) => (
            <TouchableOpacity
              key={zone}
              style={[styles.zoneOption, { borderTopColor: T.border }]}
              onPress={() => pickZone(zone)}
              activeOpacity={0.7}
            >
              <Text style={[styles.zoneOptionLabel, { color: T.textBright }]} numberOfLines={1}>
                {zoneLabel(zone)}
              </Text>
              {preferredTimeZone === zone && <Check size={16} color={T.accent} weight="bold" />}
            </TouchableOpacity>
          ))}
        </ScrollView>
      </BottomSheet>
    </View>
  );
}

/**
 * Three wordless message rows standing in for a transcript, so the choice reads
 * as a shape rather than as two labels the reader has to imagine.
 */
function LayoutSketch({ sided, T }: { sided: boolean; T: ReturnType<typeof useTheme> }) {
  const rows = sided ? [false, true, false] : [false, false, false];
  return (
    <View style={styles.sketch}>
      {rows.map((own, i) => (
        <View key={i} style={[styles.sketchRow, own && styles.sketchRowOwn]}>
          {own ? null : <View style={[styles.sketchDot, { backgroundColor: T.border }]} />}
          <View
            style={[
              styles.sketchBar,
              { backgroundColor: own ? T.accentSoft : T.surfaceHover, width: own ? 46 : 54 },
            ]}
          />
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  section: {
    paddingHorizontal: 16,
    paddingTop: 24,
    gap: 10,
  },
  sectionLabel: {
    fontSize: 11,
    fontFamily: FONT.semibold,
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
    fontFamily: FONT.medium,
  },
  layoutCard: {
    flex: 1,
    alignItems: "center",
    paddingVertical: 14,
    paddingHorizontal: 10,
    borderRadius: 12,
    gap: 8,
  },
  layoutHint: {
    fontSize: 11,
    fontFamily: FONT.regular,
    textAlign: "center",
  },
  sketch: { gap: 4, width: 72 },
  sketchRow: { flexDirection: "row", alignItems: "center", gap: 4 },
  sketchRowOwn: { justifyContent: "flex-end" },
  sketchDot: { width: 12, height: 12, borderRadius: 6 },
  sketchBar: { height: 12, borderRadius: 6 },
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
    fontFamily: FONT.medium,
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
    fontFamily: FONT.semibold,
  },
  previewSoft: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
  },
  previewSoftText: {
    fontSize: 13,
    fontFamily: FONT.semibold,
  },
  previewLabel: {
    fontSize: 12,
    fontFamily: FONT.regular,
    flex: 1,
    minWidth: 150,
  },
  zoneRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 13,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
  },
  zoneRowLabel: { fontSize: 14, fontFamily: FONT.medium },
  zoneRowValue: { flex: 1, fontSize: 13, fontFamily: FONT.medium, textAlign: "right" },
  zoneSheetTitle: {
    fontSize: 15,
    fontFamily: FONT.semibold,
    paddingHorizontal: 20,
    paddingBottom: 10,
  },
  zoneSearchWrap: { paddingHorizontal: 20, paddingBottom: 10 },
  zoneSearch: {
    fontSize: 14,
    fontFamily: FONT.regular,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
  },
  zoneList: { maxHeight: 380 },
  zoneOption: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 20,
    paddingVertical: 13,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  zoneOptionLabel: { flex: 1, fontSize: 14, fontFamily: FONT.medium },
});
