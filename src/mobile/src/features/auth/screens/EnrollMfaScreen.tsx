import React, { useEffect, useState } from "react";
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ShieldCheck } from "phosphor-react-native";
import { MfaEnrollFlow } from "@features/auth/components/MfaEnrollFlow";
import { BRAND } from "@theme/theme";
import { FONT } from "@theme/typography";
import { useAuth } from "@core/providers/AuthContext";

/**
 * Forced MFA enrollment after login, when the org/platform mandates a second
 * factor and the user has not enrolled. The enrollment token is made the active
 * bearer so the MfaService RPCs are authorised; navigation is held until the
 * flow yields real session tokens.
 */
export function EnrollMfaScreen() {
  const insets = useSafeAreaInsets();
  const { token } = useLocalSearchParams<{ token: string }>();
  const { beginForcedEnrollment, logout, setHoldNavigation } = useAuth();

  // Adopt the enrollment token as the active bearer during the first render,
  // before MfaEnrollFlow mounts and fires BeginEnrollment. A mount effect would
  // run after the child's, so that RPC would go out unauthorised.
  useState(() => {
    if (token) beginForcedEnrollment(token);
    return null;
  });

  useEffect(() => {
    if (token) setHoldNavigation(true);
  }, [token, setHoldNavigation]);

  const cancel = async () => {
    await logout();
    setHoldNavigation(false);
    router.replace("/auth" as any);
  };

  const finish = () => {
    setHoldNavigation(false);
    router.replace("/" as any);
  };

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.banner}>
        <ShieldCheck size={18} color="#fff" weight="duotone" />
        <Text style={styles.bannerText}>Your organization requires two-factor authentication</Text>
      </View>
      {token ? (
        <MfaEnrollFlow color={BRAND.violet} onDone={finish} />
      ) : (
        <View style={styles.center}>
          <ActivityIndicator color={BRAND.violet} />
        </View>
      )}
      <TouchableOpacity style={styles.cancel} onPress={cancel} activeOpacity={0.7}>
        <Text style={styles.cancelText}>Cancel and sign out</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: BRAND.midnight },
  banner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: BRAND.violet,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  bannerText: { flex: 1, color: "#fff", fontSize: 13, fontFamily: FONT.medium, lineHeight: 18 },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  cancel: { padding: 18, alignItems: "center" },
  cancelText: { fontSize: 14, fontFamily: FONT.medium, color: "rgba(255,255,255,0.5)" },
});
