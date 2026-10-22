import React from "react";
import { View, Text, StyleSheet, ActivityIndicator, Platform } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router } from "expo-router";
import { useAuth } from "@core/providers/AuthContext";
import { CreateOrganizationRow } from "@features/auth/components/CreateOrganizationRow";
import { NoOrganizations } from "@features/auth/components/NoOrganizations";
import { OrganizationList } from "@features/auth/components/OrganizationList";
import { PendingInvitations } from "@features/auth/components/PendingInvitations";
import type { OrganizationSummary } from "@features/auth/organizationSerializer";
import { useInvitationActions, useMyInvitations } from "@features/auth/useMyInvitations";
import {
  useCanCreateOrganization,
  useMyOrganizations,
  useSelectOrganization,
} from "@features/auth/useMyOrganizations";
import { DomainHeader } from "@shared/components/DomainHeader";
import { ScreenError } from "@shared/components/ScreenError";
import { useTheme } from "@shared/hooks/useTheme";
import { BOTTOM_NAV_HEIGHT } from "@theme/theme";
import { FONT } from "@theme/typography";

// Picking the current organization pops back to the home already under the You screens. A
// switch needs nothing here: AuthGate resets the whole stack once the organization changes, so
// no screen of the previous organization stays behind.
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
  const invitations = useMyInvitations().data ?? [];
  const canCreate = useCanCreateOrganization();
  const { select, selectingOrganizationId, error: selectError } = useSelectOrganization();
  const invitationActions = useInvitationActions();
  const organizations = organizationsQuery.data ?? [];
  // Each hook clears only its own error, so both show until their next attempt.
  const error = [selectError, invitationActions.error].filter(Boolean).join("\n") || null;

  const handleSelect = (organization: OrganizationSummary) => {
    // The session already holds a token for the current organization.
    if (organization.id === organizationId) {
      goHome();
      return;
    }
    void select(organization);
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
      ) : (
        <OrganizationList
          organizations={organizations}
          currentOrganizationId={organizationId}
          selectingOrganizationId={selectingOrganizationId}
          onSelect={handleSelect}
          contentContainerStyle={{ paddingTop: 8, paddingBottom: bottomPad }}
          header={
            invitations.length > 0 ? (
              <PendingInvitations
                invitations={invitations}
                pending={invitationActions.pending}
                onAccept={(invitation) => void invitationActions.accept(invitation)}
                onDecline={(invitation) => void invitationActions.decline(invitation)}
              />
            ) : null
          }
          footer={canCreate ? <CreateOrganizationRow /> : null}
          empty={<NoOrganizations askAdmin={!canCreate && invitations.length === 0} />}
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
  },
});
