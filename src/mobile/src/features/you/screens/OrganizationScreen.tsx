import React from "react";
import { View, Text, StyleSheet, ActivityIndicator, Platform } from "react-native";
import { Buildings } from "phosphor-react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router } from "expo-router";
import { useAuth } from "@core/providers/AuthContext";
import { OrganizationList } from "@features/auth/components/OrganizationList";
import { useMyOrganizations, useSelectOrganization } from "@features/auth/useMyOrganizations";
import { DomainHeader } from "@shared/components/DomainHeader";
import { ScreenError } from "@shared/components/ScreenError";
import { useTheme } from "@shared/hooks/useTheme";
import { BOTTOM_NAV_HEIGHT } from "@theme/theme";
import { FONT } from "@theme/typography";

// Pops back to the home already under the You screens rather than mounting a second one.
function goHome() {
  router.dismissTo("/");
}

export function OrganizationScreen() {
  const T = useTheme();
  const insets = useSafeAreaInsets();
  const bottomPad =
    Platform.OS === "web" ? BOTTOM_NAV_HEIGHT + 34 : BOTTOM_NAV_HEIGHT + insets.bottom;
  const { organizationId } = useAuth();
  const organizationsQuery = useMyOrganizations();
  const { select, selectingSlug, error } = useSelectOrganization(goHome);
  const organizations = organizationsQuery.data ?? [];
  const currentSlug = organizations.find((org) => org.id === organizationId)?.slug;

  const handleSelect = (slug: string) => {
    // The session already holds a token for the current organization.
    if (slug === currentSlug) {
      goHome();
      return;
    }
    void select(slug);
  };

  if (organizationsQuery.isError && !organizationsQuery.data) {
    return (
      <ScreenError
        title="Organization"
        icon="organization"
        color={T.accent}
        message="Your organizations could not be loaded."
        onRetry={() => void organizationsQuery.refetch()}
      />
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: T.pageBg }]}>
      <DomainHeader title="Organization" color={T.accent} icon="organization" />

      {error && (
        <View
          style={[styles.errorBox, { backgroundColor: T.red + "1F", borderColor: T.red + "33" }]}
        >
          <Text style={[styles.errorText, { color: T.red }]}>{error}</Text>
        </View>
      )}

      {organizationsQuery.isPending ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={T.accent} />
        </View>
      ) : organizations.length === 0 ? (
        <View style={styles.center}>
          <Buildings size={48} color={T.textDim} weight="duotone" />
          <Text style={[styles.emptyText, { color: T.textDim }]}>No organizations found.</Text>
        </View>
      ) : (
        <OrganizationList
          organizations={organizations}
          currentOrganizationId={organizationId}
          selectingSlug={selectingSlug}
          onSelect={handleSelect}
          contentContainerStyle={{ paddingTop: 8, paddingBottom: bottomPad }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  errorBox: {
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginHorizontal: 16,
    marginTop: 8,
  },
  errorText: {
    fontSize: 13,
    fontFamily: FONT.medium,
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
});
