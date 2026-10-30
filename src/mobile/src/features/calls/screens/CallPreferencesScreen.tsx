import { View, Text, ScrollView, TouchableOpacity, StyleSheet, Platform } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { DomainHeader } from "@shared/components/DomainHeader";
import { ToggleRow } from "@shared/components/ToggleRow";
import { useTheme } from "@shared/hooks/useTheme";
import { BOTTOM_NAV_HEIGHT } from "@theme/theme";
import { FONT } from "@theme/typography";
import {
  useCameraOn,
  useJoinMuted,
  usePreferredCamera,
  useRingtoneEnabled,
} from "@features/calls/callPrefs";

const CAMERAS = [
  { key: "user", label: "Front" },
  { key: "environment", label: "Back" },
] as const;

export function CallPreferencesScreen() {
  const T = useTheme();
  const insets = useSafeAreaInsets();
  const bottomPad =
    Platform.OS === "web" ? BOTTOM_NAV_HEIGHT + 34 : BOTTOM_NAV_HEIGHT + insets.bottom;
  const [ring, setRing] = useRingtoneEnabled();
  const [muted, setMuted] = useJoinMuted();
  const [camera, setCamera] = useCameraOn();
  const [facing, setFacing] = usePreferredCamera();

  return (
    <View style={[styles.container, { backgroundColor: T.pageBg }]}>
      <DomainHeader title="Calls" color={T.accent} icon="phone" />
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: bottomPad }]}>
        <Text style={[styles.sectionLabel, { color: T.textDim }]}>INCOMING</Text>
        <View style={[styles.card, { backgroundColor: T.surface, borderColor: T.border }]}>
          <ToggleRow
            label="Incoming ringtone"
            sub="Play a sound when someone calls you"
            value={ring}
            onValueChange={setRing}
          />
        </View>

        <Text style={[styles.sectionLabel, { color: T.textDim, marginTop: 24 }]}>JOINING</Text>
        <View style={[styles.card, { backgroundColor: T.surface, borderColor: T.border }]}>
          <ToggleRow
            label="Join muted"
            sub="Start with the microphone off"
            value={muted}
            onValueChange={setMuted}
            border
          />
          <ToggleRow
            label="Start with camera on"
            sub="Preview before joining, then start with video"
            value={camera}
            onValueChange={setCamera}
            border
          />
          <View style={styles.pillRow}>
            <Text style={[styles.pillLabel, { color: T.text }]}>Default camera</Text>
            <View style={styles.pills}>
              {CAMERAS.map((option) => {
                const active = facing === option.key;
                return (
                  <TouchableOpacity
                    key={option.key}
                    style={[
                      styles.pill,
                      {
                        backgroundColor: active ? T.accent : T.bg,
                        borderColor: active ? T.accent : T.border,
                      },
                    ]}
                    onPress={() => setFacing(option.key)}
                    activeOpacity={0.7}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: active }}
                    accessibilityLabel={`${option.label} camera`}
                  >
                    <Text style={[styles.pillText, { color: active ? "#fff" : T.textDim }]}>
                      {option.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
        </View>

        <Text style={[styles.note, { color: T.textDim }]}>
          These defaults apply on this device and can still be changed before joining. Choose
          speaker or headset in call setup. Available routes depend on your phone, and your last
          choice is remembered.
        </Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: 20 },
  sectionLabel: { fontSize: 11, fontFamily: FONT.semibold, letterSpacing: 0.8, marginBottom: 8 },
  card: { borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, overflow: "hidden" },
  pillRow: { paddingHorizontal: 14, paddingVertical: 13, gap: 10 },
  pillLabel: { fontSize: 14, fontFamily: FONT.medium },
  pills: { flexDirection: "row", gap: 8 },
  pill: { paddingHorizontal: 16, paddingVertical: 7, borderRadius: 8, borderWidth: 1 },
  pillText: { fontSize: 13, fontFamily: FONT.medium },
  note: {
    fontSize: 12,
    fontFamily: FONT.regular,
    marginTop: 20,
    lineHeight: 18,
    textAlign: "center",
  },
});
