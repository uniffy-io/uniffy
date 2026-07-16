import React, { useState, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Switch,
  TouchableOpacity,
  Platform,
  ActivityIndicator,
} from "react-native";
import { useQuery } from "@tanstack/react-query";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { DomainHeader } from "@shared/components/DomainHeader";
import { useTheme } from "@shared/hooks/useTheme";
import { BOTTOM_NAV_HEIGHT } from "@theme/theme";
import type { ThemeColors } from "@theme/theme";
import { FONT } from "@theme/typography";
import { useAuth } from "@core/providers/AuthContext";
import { settingsApi } from "@core/api/settingsApi";
import { useRingtoneEnabled } from "@features/calls/callPrefs";

interface Prefs {
  toastEnabled: boolean;
  soundEnabled: boolean;
  emailEnabled: boolean;
  emailFrequency: string;
}

const FREQUENCIES: { key: string; label: string }[] = [
  { key: "instant", label: "Instant" },
  { key: "hourly", label: "Hourly" },
  { key: "daily", label: "Daily" },
];

export function NotificationPreferencesScreen() {
  const T = useTheme();
  const insets = useSafeAreaInsets();
  const bottomPad =
    Platform.OS === "web" ? BOTTOM_NAV_HEIGHT + 34 : BOTTOM_NAV_HEIGHT + insets.bottom;
  const { isAuthenticated } = useAuth();
  const [profileId, setProfileId] = useState<string | null>(null);
  const [prefs, setPrefs] = useState<Prefs | null>(null);
  const [ringtoneEnabled, setRingtoneEnabled] = useRingtoneEnabled();

  const settingsQuery = useQuery({
    queryKey: ["settings", "effective"],
    enabled: isAuthenticated,
    queryFn: () => settingsApi.getEffectiveSettings(),
  });

  // Sync editable prefs from the fetched settings whenever the query delivers a
  // new snapshot. Adjusting state during render (guarded on the data identity)
  // avoids an effect that would cascade a second render.
  const data = settingsQuery.data;
  const [syncedData, setSyncedData] = useState<typeof data>(undefined);
  if (data && data !== syncedData) {
    setSyncedData(data);
    const n = data.effectiveSettings?.notifications;
    setProfileId(data.profile?.id ?? null);
    setPrefs({
      toastEnabled: n?.toastEnabled ?? true,
      soundEnabled: n?.soundEnabled ?? true,
      emailEnabled: n?.emailEnabled ?? false,
      emailFrequency: n?.emailFrequency || "instant",
    });
  }

  const persist = useCallback(
    (next: Prefs) => {
      if (!profileId) return;
      settingsApi
        .updateProfile({
          profileId,
          notifications: {
            toastEnabled: next.toastEnabled,
            soundEnabled: next.soundEnabled,
            emailEnabled: next.emailEnabled,
            emailFrequency: next.emailFrequency,
          },
        })
        .catch(() => {});
    },
    [profileId],
  );

  const update = useCallback(
    (patch: Partial<Prefs>) => {
      setPrefs((prev) => {
        if (!prev) return prev;
        const next = { ...prev, ...patch };
        persist(next);
        return next;
      });
    },
    [persist],
  );

  return (
    <View style={[styles.container, { backgroundColor: T.pageBg }]}>
      <DomainHeader title="Notifications" color={T.accent} icon="bell" />

      {settingsQuery.isLoading || !prefs ? (
        <View style={styles.loadingWrap}>
          <ActivityIndicator size="large" color={T.accent} />
        </View>
      ) : (
        <ScrollView contentContainerStyle={[styles.content, { paddingBottom: bottomPad }]}>
          <Text style={[styles.sectionLabel, { color: T.textDim }]}>IN-APP</Text>
          <View style={[styles.card, { backgroundColor: T.surface, borderColor: T.border }]}>
            <ToggleRow
              T={T}
              label="In-app alerts"
              sub="Show toast banners for new activity"
              value={prefs.toastEnabled}
              onValueChange={(v) => update({ toastEnabled: v })}
              border
            />
            <ToggleRow
              T={T}
              label="Sound"
              sub="Play a sound for new notifications"
              value={prefs.soundEnabled}
              onValueChange={(v) => update({ soundEnabled: v })}
              border
            />
            <ToggleRow
              T={T}
              label="Call ringtone"
              sub="Ring for incoming calls while the app is open"
              value={ringtoneEnabled}
              onValueChange={setRingtoneEnabled}
            />
          </View>

          <Text style={[styles.sectionLabel, { color: T.textDim, marginTop: 24 }]}>EMAIL</Text>
          <View style={[styles.card, { backgroundColor: T.surface, borderColor: T.border }]}>
            <ToggleRow
              T={T}
              label="Email notifications"
              sub="Get a summary by email"
              value={prefs.emailEnabled}
              onValueChange={(v) => update({ emailEnabled: v })}
              border={prefs.emailEnabled}
            />
            {prefs.emailEnabled ? (
              <View style={styles.freqRow}>
                <Text style={[styles.freqLabel, { color: T.text }]}>Frequency</Text>
                <View style={styles.freqPills}>
                  {FREQUENCIES.map((f) => {
                    const active = prefs.emailFrequency === f.key;
                    return (
                      <TouchableOpacity
                        key={f.key}
                        style={[
                          styles.freqPill,
                          {
                            backgroundColor: active ? T.accent : T.bg,
                            borderColor: active ? T.accent : T.border,
                          },
                        ]}
                        onPress={() => update({ emailFrequency: f.key })}
                        activeOpacity={0.7}
                      >
                        <Text style={[styles.freqPillText, { color: active ? "#fff" : T.textDim }]}>
                          {f.label}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>
            ) : null}
          </View>

          <Text style={[styles.note, { color: T.textDim }]}>
            Push notifications to this device are not yet available in the mobile app.
          </Text>
        </ScrollView>
      )}
    </View>
  );
}

function ToggleRow({
  T,
  label,
  sub,
  value,
  onValueChange,
  border,
}: {
  T: ThemeColors;
  label: string;
  sub: string;
  value: boolean;
  onValueChange: (v: boolean) => void;
  border?: boolean;
}) {
  return (
    <View
      style={[
        styles.toggleRow,
        border
          ? { borderBottomColor: T.border, borderBottomWidth: StyleSheet.hairlineWidth }
          : null,
      ]}
    >
      <View style={{ flex: 1 }}>
        <Text style={[styles.toggleLabel, { color: T.textBright }]}>{label}</Text>
        <Text style={[styles.toggleSub, { color: T.textDim }]}>{sub}</Text>
      </View>
      <Switch
        value={value}
        onValueChange={onValueChange}
        trackColor={{ true: T.accent, false: T.border }}
        thumbColor="#fff"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  loadingWrap: { flex: 1, alignItems: "center", justifyContent: "center" },
  content: { padding: 20 },
  sectionLabel: { fontSize: 11, fontFamily: FONT.semibold, letterSpacing: 0.8, marginBottom: 8 },
  card: { borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, overflow: "hidden" },
  toggleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 13,
  },
  toggleLabel: { fontSize: 15, fontFamily: FONT.medium },
  toggleSub: { fontSize: 12, fontFamily: FONT.regular, marginTop: 2 },
  freqRow: { paddingHorizontal: 14, paddingVertical: 13, gap: 10 },
  freqLabel: { fontSize: 14, fontFamily: FONT.medium },
  freqPills: { flexDirection: "row", gap: 8 },
  freqPill: { paddingHorizontal: 16, paddingVertical: 7, borderRadius: 8, borderWidth: 1 },
  freqPillText: { fontSize: 13, fontFamily: FONT.medium },
  note: {
    fontSize: 12,
    fontFamily: FONT.regular,
    marginTop: 20,
    lineHeight: 18,
    textAlign: "center",
  },
});
