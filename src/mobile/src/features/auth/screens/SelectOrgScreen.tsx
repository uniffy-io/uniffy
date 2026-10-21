import React, { useEffect, useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Animated,
  Platform,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Buildings, SignOut } from "phosphor-react-native";
import { useAuth } from "@core/providers/AuthContext";
import { OrganizationList } from "@features/auth/components/OrganizationList";
import { useMyOrganizations, useSelectOrganization } from "@features/auth/useMyOrganizations";
import { useSignOut } from "@features/auth/useSignOut";
import { useTheme } from "@shared/hooks/useTheme";
import { FONT } from "@theme/typography";

export function SelectOrgScreen() {
  const T = useTheme();
  const insets = useSafeAreaInsets();
  const { user, organizationId } = useAuth();
  const { signOut, signingOut } = useSignOut();
  const organizationsQuery = useMyOrganizations();
  const { select, selectingOrganizationId, error } = useSelectOrganization();
  const organizations = organizationsQuery.data ?? [];
  const loadFailed = organizationsQuery.isError && !organizationsQuery.data;

  const [enterAnim] = useState(() => new Animated.Value(0));

  useEffect(() => {
    Animated.timing(enterAnim, {
      toValue: 1,
      duration: 450,
      useNativeDriver: Platform.OS !== "web",
    }).start();
  }, [enterAnim]);

  return (
    <Animated.View
      style={[
        styles.root,
        {
          backgroundColor: T.pageBg,
          opacity: enterAnim,
          transform: [
            { translateY: enterAnim.interpolate({ inputRange: [0, 1], outputRange: [12, 0] }) },
          ],
        },
      ]}
    >
      <View style={[styles.header, { paddingTop: insets.top + 16 }]}>
        <Text style={[styles.title, { color: T.textBright }]}>Select workspace</Text>
        {user && (
          <Text style={[styles.subtitle, { color: T.textDim }]}>Signed in as {user.email}</Text>
        )}
      </View>

      {error && (
        <View style={styles.errorBox}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      )}

      {organizationsQuery.isPending ? (
        <View style={styles.center}>
          <ActivityIndicator color={T.accent} size="large" />
        </View>
      ) : loadFailed ? (
        <View style={styles.center}>
          <Buildings size={48} color={T.textDim} weight="duotone" />
          <Text style={[styles.emptyText, { color: T.textDim }]}>
            Your organizations could not be loaded.
          </Text>
          <TouchableOpacity
            style={[styles.retryButton, { borderColor: T.border }]}
            onPress={() => void organizationsQuery.refetch()}
            disabled={organizationsQuery.isFetching}
            activeOpacity={0.7}
          >
            <Text style={[styles.retryText, { color: T.accent }]}>
              {organizationsQuery.isFetching ? "Loading..." : "Try again"}
            </Text>
          </TouchableOpacity>
        </View>
      ) : organizations.length === 0 ? (
        <View style={styles.center}>
          <Buildings size={48} color={T.textDim} weight="duotone" />
          <Text style={[styles.emptyText, { color: T.textDim }]}>
            No organizations found.{"\n"}Ask an admin to invite you.
          </Text>
        </View>
      ) : (
        <OrganizationList
          organizations={organizations}
          currentOrganizationId={organizationId}
          selectingOrganizationId={selectingOrganizationId}
          onSelect={(organization) => void select(organization)}
          contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
        />
      )}

      <TouchableOpacity
        style={[
          styles.logoutButton,
          { borderColor: "#FA525240", marginBottom: insets.bottom + 16 },
        ]}
        onPress={() => void signOut()}
        disabled={signingOut}
        activeOpacity={0.7}
      >
        <SignOut size={15} color="#FA5252" weight="bold" />
        <Text style={styles.logoutText}>{signingOut ? "Signing out..." : "Sign out"}</Text>
      </TouchableOpacity>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    paddingHorizontal: 24,
    paddingBottom: 20,
    gap: 4,
  },
  title: {
    fontSize: 24,
    fontFamily: FONT.bold,
  },
  subtitle: {
    fontSize: 14,
    fontFamily: FONT.regular,
  },
  errorBox: {
    backgroundColor: "rgba(250,82,82,0.12)",
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "rgba(250,82,82,0.2)",
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginHorizontal: 24,
    marginBottom: 12,
  },
  errorText: {
    fontSize: 13,
    fontFamily: FONT.medium,
    color: "#FA5252",
  },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    paddingHorizontal: 32,
  },
  emptyText: {
    fontSize: 15,
    fontFamily: FONT.regular,
    textAlign: "center",
    lineHeight: 22,
  },
  retryButton: {
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
  },
  retryText: {
    fontSize: 14,
    fontFamily: FONT.semibold,
  },
  logoutButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    marginHorizontal: 16,
    paddingVertical: 14,
    borderRadius: 12,
    borderWidth: 1,
  },
  logoutText: {
    fontSize: 15,
    fontFamily: FONT.medium,
    color: "#FA5252",
  },
});
