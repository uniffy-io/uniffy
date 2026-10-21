import React from "react";
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { Check } from "phosphor-react-native";
import type { OrganizationSummary } from "@features/auth/organizationSerializer";
import { useTheme } from "@shared/hooks/useTheme";
import { FONT } from "@theme/typography";
import { OrganizationRole } from "@uniffy/proto/common/v1/common_pb";

const ROLE_LABELS: Partial<Record<OrganizationRole, string>> = {
  [OrganizationRole.OWNER]: "Owner",
  [OrganizationRole.ADMIN]: "Admin",
  [OrganizationRole.MEMBER]: "Member",
};

function getRoleLabel(role: OrganizationRole): string {
  return ROLE_LABELS[role] ?? "Member";
}

function getOrgInitials(name: string): string {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0])
    .join("")
    .toUpperCase();
  return initials || "?";
}

type OrganizationListProps = {
  organizations: OrganizationSummary[];
  currentOrganizationId: string | null;
  selectingOrganizationId: string | null;
  onSelect: (organization: OrganizationSummary) => void;
  contentContainerStyle?: StyleProp<ViewStyle>;
};

export function OrganizationList({
  organizations,
  currentOrganizationId,
  selectingOrganizationId,
  onSelect,
  contentContainerStyle,
}: OrganizationListProps) {
  const isBusy = selectingOrganizationId !== null;

  return (
    <FlatList
      data={organizations}
      keyExtractor={(item) => item.id}
      contentContainerStyle={[styles.list, contentContainerStyle]}
      renderItem={({ item }) => (
        <OrganizationRow
          organization={item}
          isCurrent={item.id === currentOrganizationId}
          isSelecting={item.id === selectingOrganizationId}
          isBusy={isBusy}
          onSelect={onSelect}
        />
      )}
    />
  );
}

type OrganizationRowProps = {
  organization: OrganizationSummary;
  isCurrent: boolean;
  isSelecting: boolean;
  isBusy: boolean;
  onSelect: (organization: OrganizationSummary) => void;
};

function OrganizationRow({
  organization,
  isCurrent,
  isSelecting,
  isBusy,
  onSelect,
}: OrganizationRowProps) {
  const T = useTheme();
  const { suspended } = organization;
  const tint = suspended ? T.textDim : T.accent;

  return (
    <TouchableOpacity
      style={[
        styles.row,
        { backgroundColor: T.surface, borderColor: T.border },
        isBusy && !isSelecting && styles.idle,
      ]}
      onPress={suspended ? undefined : () => onSelect(organization)}
      disabled={suspended || isBusy}
      activeOpacity={0.7}
      accessibilityRole="button"
      accessibilityState={{
        selected: isCurrent,
        disabled: suspended || isBusy,
        busy: isSelecting,
      }}
    >
      <LinearGradient colors={[tint + "20", tint + "08"]} style={styles.avatar}>
        <Text style={[styles.initials, { color: tint }]}>{getOrgInitials(organization.name)}</Text>
      </LinearGradient>

      <View style={styles.info}>
        <Text
          style={[styles.name, { color: suspended ? T.textDim : T.textBright }]}
          numberOfLines={1}
        >
          {organization.name}
        </Text>
        <View style={styles.meta}>
          <View
            style={[styles.badge, { backgroundColor: suspended ? T.surfaceHover : T.accentSoft }]}
          >
            <Text style={[styles.badgeText, { color: tint }]}>
              {getRoleLabel(organization.role)}
            </Text>
          </View>
          {suspended && (
            <View style={[styles.badge, styles.suspendedBadge, { borderColor: T.border }]}>
              <Text style={[styles.badgeText, { color: T.textDim }]}>Suspended</Text>
            </View>
          )}
        </View>
      </View>

      <View style={styles.trailing}>
        {isSelecting ? (
          <ActivityIndicator color={T.accent} size="small" />
        ) : isCurrent ? (
          <Check size={18} color={T.accent} weight="bold" />
        ) : null}
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  list: {
    paddingHorizontal: 16,
    gap: 10,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    padding: 14,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    gap: 14,
  },
  idle: {
    opacity: 0.6,
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  initials: {
    fontSize: 16,
    fontFamily: FONT.bold,
  },
  info: {
    flex: 1,
    gap: 4,
  },
  name: {
    fontSize: 16,
    fontFamily: FONT.semibold,
  },
  meta: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
  },
  suspendedBadge: {
    borderWidth: StyleSheet.hairlineWidth,
  },
  badgeText: {
    fontSize: 11,
    fontFamily: FONT.semibold,
  },
  trailing: {
    width: 20,
    alignItems: "center",
    justifyContent: "center",
  },
});
