import { View, Text, ScrollView, Switch, TouchableOpacity, StyleSheet } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { DomainHeader } from "@shared/components/DomainHeader";
import { useTheme } from "@shared/hooks/useTheme";
import { FONT } from "@theme/typography";
import {
  useCameraOn,
  useJoinMuted,
  usePreferredCamera,
  useRingtoneEnabled,
} from "@features/calls/callPrefs";

export function CallPreferencesScreen() {
  const T = useTheme();
  const insets = useSafeAreaInsets();
  const [ring, setRing] = useRingtoneEnabled();
  const [muted, setMuted] = useJoinMuted();
  const [camera, setCamera] = useCameraOn();
  const [facing, setFacing] = usePreferredCamera();
  const rows = [
    {
      label: "Incoming ringtone",
      text: "Play a sound when someone calls you.",
      value: ring,
      change: setRing,
    },
    { label: "Join muted", text: "Start with microphone off.", value: muted, change: setMuted },
    {
      label: "Start with camera on",
      text: "Show preview before joining and start with video.",
      value: camera,
      change: setCamera,
    },
  ];
  return (
    <View style={{ flex: 1, backgroundColor: T.pageBg }}>
      <DomainHeader title="Calls" color={T.accent} icon="phone" />
      <ScrollView
        contentContainerStyle={{ padding: 20, paddingBottom: insets.bottom + 100, gap: 20 }}
      >
        <Text style={{ color: T.textDim, fontFamily: FONT.regular }}>
          Defaults for calls on this device. You can change them before joining.
        </Text>
        <View style={{ backgroundColor: T.surface, borderRadius: 16, paddingHorizontal: 16 }}>
          {rows.map((row) => (
            <View key={row.label} style={styles.row}>
              <View style={{ flex: 1, gap: 4 }}>
                <Text style={{ color: T.textBright, fontFamily: FONT.medium }}>{row.label}</Text>
                <Text style={{ color: T.textDim, fontFamily: FONT.regular, fontSize: 13 }}>
                  {row.text}
                </Text>
              </View>
              <Switch
                accessibilityLabel={row.label}
                value={row.value}
                onValueChange={row.change}
                trackColor={{ true: T.accent }}
              />
            </View>
          ))}
        </View>
        <View style={{ backgroundColor: T.surface, borderRadius: 16, padding: 16, gap: 14 }}>
          <Text style={{ color: T.textBright, fontFamily: FONT.medium }}>Default camera</Text>
          <View style={{ flexDirection: "row", gap: 10 }}>
            {(["user", "environment"] as const).map((value) => (
              <TouchableOpacity
                key={value}
                accessibilityRole="radio"
                accessibilityState={{ checked: facing === value }}
                onPress={() => setFacing(value)}
                style={{
                  flex: 1,
                  minHeight: 44,
                  borderRadius: 10,
                  justifyContent: "center",
                  alignItems: "center",
                  backgroundColor: facing === value ? T.accent : T.surfaceHover,
                }}
              >
                <Text
                  style={{ color: facing === value ? "white" : T.text, fontFamily: FONT.medium }}
                >
                  {value === "user" ? "Front" : "Back"}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
          <Text style={{ color: T.textDim, fontFamily: FONT.regular, fontSize: 13 }}>
            Choose speaker or headset in call setup. Available routes depend on your phone, and your
            last selection is remembered.
          </Text>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 16, minHeight: 80, paddingVertical: 16 },
});
