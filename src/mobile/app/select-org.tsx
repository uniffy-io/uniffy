import React, { useEffect, useState } from "react";
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { Buildings, SignOut } from "phosphor-react-native";
import { useAuth } from "@/context/auth-context";
import { authApi } from "@/api/authApi";
import { useTheme } from "@/hooks/useTheme";
import type { PlainMessage } from "@bufbuild/protobuf";
import type { MyOrganization } from "@uniffy/proto/organizations/v1/organizations_pb";
import { OrganizationRole } from "@uniffy/proto/common/v1/common_pb";

const ROLE_LABELS: Record<number, string> = {
  [OrganizationRole.OWNER]: "Owner",
  [OrganizationRole.ADMIN]: "Admin",
  [OrganizationRole.MEMBER]: "Member",
};

function getRoleLabel(role: number): string {
  return ROLE_LABELS[role] ?? "Member";
}

function getOrgInitials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase();
}

export default function SelectOrgScreen() {
  const T = useTheme();
  const insets = useSafeAreaInsets();
  const { user, selectOrganization, logout } = useAuth();

  const [orgs, setOrgs] = useState<PlainMessage<MyOrganization>[]>([]);
  const [loading, setLoading] = useState(true);
  const [selecting, setSelecting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    authApi
      .listMyOrganizations()
      .then((res) => {
        if (!cancelled) {
          setOrgs(res.organizations as unknown as PlainMessage<MyOrganization>[]);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err?.message || "Failed to load organizations");
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleSelect = async (slug: string) => {
    setSelecting(slug);
    setError(null);
    try {
      await selectOrganization(slug);
    } catch (err: any) {
      setError(err?.message || "Failed to select organization");
      setSelecting(null);
    }
  };

  return (
    <View style={[styles.root, { backgroundColor: T.pageBg }]}>
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

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={T.accent} size="large" />
        </View>
      ) : orgs.length === 0 ? (
        <View style={styles.center}>
          <Buildings size={48} color={T.textDim} weight="duotone" />
          <Text style={[styles.emptyText, { color: T.textDim }]}>
            No organizations found.{"\n"}Ask an admin to invite you.
          </Text>
        </View>
      ) : (
        <FlatList
          data={orgs}
          keyExtractor={(item) => item.organization?.id ?? ""}
          contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + 24 }]}
          renderItem={({ item }) => {
            const org = item.organization;
            if (!org) return null;
            const isSelecting = selecting === org.slug;

            return (
              <TouchableOpacity
                style={[styles.orgRow, { backgroundColor: T.surface, borderColor: T.border }]}
                onPress={() => handleSelect(org.slug)}
                disabled={!!selecting}
                activeOpacity={0.7}
              >
                <LinearGradient
                  colors={[T.accent + "20", T.accent + "08"]}
                  style={styles.orgAvatar}
                >
                  <Text style={[styles.orgInitials, { color: T.accent }]}>
                    {getOrgInitials(org.name)}
                  </Text>
                </LinearGradient>

                <View style={styles.orgInfo}>
                  <Text style={[styles.orgName, { color: T.textBright }]}>{org.name}</Text>
                  <View style={styles.orgMeta}>
                    <View style={[styles.roleBadge, { backgroundColor: T.accentSoft }]}>
                      <Text style={[styles.roleText, { color: T.accent }]}>
                        {getRoleLabel(item.role)}
                      </Text>
                    </View>
                  </View>
                </View>

                {isSelecting && <ActivityIndicator color={T.accent} size="small" />}
              </TouchableOpacity>
            );
          }}
        />
      )}

      <TouchableOpacity
        style={[
          styles.logoutButton,
          { borderColor: "#FA525240", marginBottom: insets.bottom + 16 },
        ]}
        onPress={logout}
        activeOpacity={0.7}
      >
        <SignOut size={15} color="#FA5252" weight="bold" />
        <Text style={styles.logoutText}>Sign out</Text>
      </TouchableOpacity>
    </View>
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
    fontFamily: "Inter_700Bold",
  },
  subtitle: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
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
    fontFamily: "Inter_500Medium",
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
    fontFamily: "Inter_400Regular",
    textAlign: "center",
    lineHeight: 22,
  },
  list: {
    paddingHorizontal: 16,
    gap: 10,
  },
  orgRow: {
    flexDirection: "row",
    alignItems: "center",
    padding: 14,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    gap: 14,
  },
  orgAvatar: {
    width: 44,
    height: 44,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  orgInitials: {
    fontSize: 16,
    fontFamily: "Inter_700Bold",
  },
  orgInfo: {
    flex: 1,
    gap: 4,
  },
  orgName: {
    fontSize: 16,
    fontFamily: "Inter_600SemiBold",
  },
  orgMeta: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  roleBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
  },
  roleText: {
    fontSize: 11,
    fontFamily: "Inter_600SemiBold",
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
    fontFamily: "Inter_500Medium",
    color: "#FA5252",
  },
});
