import React from "react";
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator } from "react-native";
import { OrganizationAvatar } from "@features/auth/components/OrganizationList";
import {
  invitationRowState,
  invitationSubtitle,
  type InvitationRowState,
  type PendingInvitationAction,
} from "@features/auth/invitationRows";
import type { InvitationSummary } from "@features/auth/organizationSerializer";
import { useTheme } from "@shared/hooks/useTheme";
import { FONT } from "@theme/typography";

type PendingInvitationsProps = {
  invitations: InvitationSummary[];
  pending: PendingInvitationAction | null;
  onAccept: (invitation: InvitationSummary) => void;
  onDecline: (invitation: InvitationSummary) => void;
};

export function PendingInvitations({
  invitations,
  pending,
  onAccept,
  onDecline,
}: PendingInvitationsProps) {
  const T = useTheme();
  if (invitations.length === 0) return null;

  return (
    <View style={styles.section}>
      <Text style={[styles.label, { color: T.textDim }]}>Invitations</Text>
      {invitations.map((invitation) => (
        <InvitationRow
          key={invitation.id}
          invitation={invitation}
          state={invitationRowState(pending, invitation.id)}
          onAccept={onAccept}
          onDecline={onDecline}
        />
      ))}
    </View>
  );
}

type InvitationRowProps = {
  invitation: InvitationSummary;
  state: InvitationRowState;
  onAccept: (invitation: InvitationSummary) => void;
  onDecline: (invitation: InvitationSummary) => void;
};

function InvitationRow({ invitation, state, onAccept, onDecline }: InvitationRowProps) {
  const T = useTheme();
  const { accepting, declining, disabled } = state;
  const busy = accepting || declining;

  return (
    <View
      style={[
        styles.row,
        { backgroundColor: T.surface, borderColor: T.border },
        disabled && !busy && styles.idle,
      ]}
    >
      <View style={styles.summary}>
        <OrganizationAvatar name={invitation.organizationName} tint={T.accent} />
        <View style={styles.info}>
          <Text style={[styles.name, { color: T.textBright }]} numberOfLines={1}>
            {invitation.organizationName}
          </Text>
          <Text style={[styles.subtitle, { color: T.textDim }]} numberOfLines={2}>
            {invitationSubtitle(invitation)}
          </Text>
        </View>
      </View>

      <View style={styles.actions}>
        <TouchableOpacity
          style={[styles.button, styles.secondaryButton, { borderColor: T.border }]}
          onPress={() => onDecline(invitation)}
          disabled={disabled}
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityLabel={`Decline the invitation to ${invitation.organizationName}`}
          accessibilityState={{ disabled, busy: declining }}
        >
          {declining ? (
            <ActivityIndicator color={T.textDim} size="small" />
          ) : (
            <Text style={[styles.buttonText, { color: T.text }]}>Decline</Text>
          )}
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.button, { backgroundColor: disabled ? T.surfaceHover : T.accent }]}
          onPress={() => onAccept(invitation)}
          disabled={disabled}
          activeOpacity={0.8}
          accessibilityRole="button"
          accessibilityLabel={`Accept the invitation to ${invitation.organizationName}`}
          accessibilityState={{ disabled, busy: accepting }}
        >
          {accepting ? (
            <ActivityIndicator color={T.accent} size="small" />
          ) : (
            <Text style={[styles.buttonText, { color: disabled ? T.textDim : "#fff" }]}>
              Accept
            </Text>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    gap: 10,
    paddingBottom: 8,
  },
  label: {
    fontSize: 11,
    fontFamily: FONT.semibold,
    letterSpacing: 0.8,
    textTransform: "uppercase",
  },
  row: {
    padding: 14,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    gap: 12,
  },
  idle: {
    opacity: 0.6,
  },
  summary: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
  },
  info: {
    flex: 1,
    gap: 2,
  },
  name: {
    fontSize: 16,
    fontFamily: FONT.semibold,
  },
  subtitle: {
    fontSize: 13,
    fontFamily: FONT.regular,
  },
  actions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: 8,
  },
  button: {
    minWidth: 88,
    minHeight: 40,
    paddingHorizontal: 16,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  secondaryButton: {
    borderWidth: 1,
  },
  buttonText: {
    fontSize: 14,
    fontFamily: FONT.semibold,
  },
});
