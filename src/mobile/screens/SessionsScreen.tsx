import React from "react";
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Platform,
  Alert,
} from "react-native";
import { DeviceMobile, Desktop, Globe, SignOut } from "phosphor-react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { DomainHeader } from "@/components/DomainHeader";
import { useTheme } from "@/hooks/useTheme";
import { useSessions } from "@/hooks/useSessions";
import { BOTTOM_NAV_HEIGHT } from "@/constants/theme";
import { FONT } from "@/constants/typography";

function getDeviceIcon(label: string) {
  const lower = label.toLowerCase();
  if (lower.includes("mobile") || lower.includes("iphone") || lower.includes("android")) {
    return DeviceMobile;
  }
  if (
    lower.includes("desktop") ||
    lower.includes("mac") ||
    lower.includes("windows") ||
    lower.includes("linux")
  ) {
    return Desktop;
  }
  return Globe;
}

export function SessionsScreen() {
  const T = useTheme();
  const insets = useSafeAreaInsets();
  const bottomPad =
    Platform.OS === "web" ? BOTTOM_NAV_HEIGHT + 34 : BOTTOM_NAV_HEIGHT + insets.bottom;

  const { sessions, isLoading, revokeSession, isRevoking, revokeOtherSessions, isRevokingOthers } =
    useSessions();

  const otherSessionsCount = sessions.filter((s) => !s.isCurrent).length;

  const handleRevoke = (sessionId: string, label: string) => {
    Alert.alert("Revoke Session", `Sign out of "${label}"?`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Sign Out",
        style: "destructive",
        onPress: () => revokeSession(sessionId),
      },
    ]);
  };

  const handleRevokeAll = () => {
    Alert.alert(
      "Sign Out Other Sessions",
      `This will sign out ${otherSessionsCount} other ${otherSessionsCount === 1 ? "session" : "sessions"}.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Sign Out All",
          style: "destructive",
          onPress: () => revokeOtherSessions(),
        },
      ],
    );
  };

  return (
    <View style={[styles.container, { backgroundColor: T.pageBg }]}>
      <DomainHeader title="Sessions" color={T.accent} icon="devices" />

      {isLoading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={T.accent} />
        </View>
      ) : (
        <FlatList
          data={sessions}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ paddingBottom: bottomPad, paddingTop: 8 }}
          renderItem={({ item }) => {
            const DeviceIcon = getDeviceIcon(item.deviceLabel);
            return (
              <View
                style={[styles.sessionCard, { backgroundColor: T.surface, borderColor: T.border }]}
              >
                <View style={[styles.deviceIconWrap, { backgroundColor: T.surfaceHover }]}>
                  <DeviceIcon size={18} color={T.text} weight="regular" />
                </View>
                <View style={{ flex: 1 }}>
                  <View style={styles.labelRow}>
                    <Text style={[styles.deviceLabel, { color: T.textBright }]}>
                      {item.deviceLabel || "Unknown device"}
                    </Text>
                    {item.isCurrent && (
                      <View
                        style={[
                          styles.currentBadge,
                          { backgroundColor: T.accentSoft, borderColor: T.accent + "40" },
                        ]}
                      >
                        <Text style={[styles.currentBadgeText, { color: T.accent }]}>
                          This device
                        </Text>
                      </View>
                    )}
                  </View>
                  <Text style={[styles.lastActivity, { color: T.textDim }]}>
                    {item.lastActivityFormatted}
                  </Text>
                </View>
                {!item.isCurrent && (
                  <TouchableOpacity
                    style={[styles.revokeBtn, { borderColor: "#FA525240" }]}
                    onPress={() => handleRevoke(item.id, item.deviceLabel)}
                    disabled={isRevoking}
                    activeOpacity={0.7}
                  >
                    <SignOut size={14} color="#FA5252" weight="regular" />
                  </TouchableOpacity>
                )}
              </View>
            );
          }}
          ListFooterComponent={
            otherSessionsCount > 0 ? (
              <TouchableOpacity
                style={[styles.revokeAllBtn, { borderColor: "#FA525240" }]}
                onPress={handleRevokeAll}
                disabled={isRevokingOthers}
                activeOpacity={0.7}
              >
                {isRevokingOthers ? (
                  <ActivityIndicator size="small" color="#FA5252" />
                ) : (
                  <>
                    <SignOut size={15} color="#FA5252" weight="regular" />
                    <Text style={styles.revokeAllText}>Sign out all other sessions</Text>
                  </>
                )}
              </TouchableOpacity>
            ) : null
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  loadingContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  sessionCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginHorizontal: 16,
    marginTop: 8,
    padding: 14,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
  },
  deviceIconWrap: {
    width: 38,
    height: 38,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  labelRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  deviceLabel: {
    fontSize: 14,
    fontFamily: FONT.medium,
  },
  currentBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
    borderWidth: 1,
  },
  currentBadgeText: {
    fontSize: 10,
    fontFamily: FONT.semibold,
  },
  lastActivity: {
    fontSize: 12,
    fontFamily: FONT.regular,
    marginTop: 2,
  },
  revokeBtn: {
    width: 34,
    height: 34,
    borderRadius: 9,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  revokeAllBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    marginHorizontal: 16,
    marginTop: 16,
    paddingVertical: 14,
    borderRadius: 12,
    borderWidth: 1,
  },
  revokeAllText: {
    fontSize: 15,
    fontFamily: FONT.medium,
    color: "#FA5252",
  },
});
