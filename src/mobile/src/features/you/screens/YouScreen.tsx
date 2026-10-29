import React from "react";
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, Platform } from "react-native";
import {
  Buildings,
  Devices,
  Bell,
  Phone,
  ShieldCheck,
  Moon,
  Question,
  ChatText,
  Info,
  SignOut,
  CaretRight,
} from "phosphor-react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router, type Href } from "expo-router";
import { useTheme } from "@shared/hooks/useTheme";
import { useAuth } from "@core/providers/AuthContext";
import { useMyOrganizations } from "@features/auth/useMyOrganizations";
import { useSignOut } from "@features/auth/useSignOut";
import { useSessions } from "@features/you/useSessions";
import { Avatar } from "@shared/components/Avatar";
import { DomainHeader } from "@shared/components/DomainHeader";
import { BOTTOM_NAV_HEIGHT } from "@theme/theme";
import { FONT } from "@theme/typography";

export function YouScreen() {
  const T = useTheme();
  const insets = useSafeAreaInsets();
  const bottomPad =
    Platform.OS === "web" ? BOTTOM_NAV_HEIGHT + 34 : BOTTOM_NAV_HEIGHT + insets.bottom;
  const { user, organizationId } = useAuth();
  const { signOut, signingOut } = useSignOut();
  const { sessions } = useSessions();
  const { data: organizations } = useMyOrganizations();

  const userName = user?.fullName || user?.username || "User";
  const userEmail = user?.email || "";
  const sessionCount = sessions.length;
  const organizationName = organizations?.find((org) => org.id === organizationId)?.name;

  return (
    <View style={[styles.container, { backgroundColor: T.pageBg }]}>
      <DomainHeader title="You" color={T.accent} icon="user" />

      <ScrollView
        contentContainerStyle={{ paddingBottom: bottomPad }}
        showsVerticalScrollIndicator={false}
      >
        <View style={[styles.profileHeader, { paddingTop: 24 }]}>
          <Avatar name={userName} avatarUrl={user?.avatarUrl} size={72} accentColor={T.accent} />
          <View style={{ alignItems: "center", gap: 4 }}>
            <Text style={[styles.profileName, { color: T.textBright }]}>{userName}</Text>
            <Text style={[styles.profileEmail, { color: T.textDim }]}>{userEmail}</Text>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={[styles.sectionLabel, { color: T.textDim }]}>ACCOUNT</Text>
          <View style={[styles.sectionCard, { backgroundColor: T.surface, borderColor: T.border }]}>
            <TouchableOpacity
              style={[
                styles.settingRow,
                { borderBottomColor: T.border, borderBottomWidth: StyleSheet.hairlineWidth },
              ]}
              onPress={() => router.push("/you/organization" as any)}
              activeOpacity={0.7}
            >
              <View style={[styles.settingIcon, { backgroundColor: T.surfaceHover }]}>
                <Buildings size={15} color={T.text} weight="regular" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.settingLabel, { color: T.textBright }]}>Organization</Text>
                <Text style={[styles.settingSub, { color: T.textDim }]} numberOfLines={1}>
                  {organizationName || "Switch organization"}
                </Text>
              </View>
              <CaretRight size={15} color={T.textDim} weight="regular" />
            </TouchableOpacity>

            <TouchableOpacity
              style={[
                styles.settingRow,
                { borderBottomColor: T.border, borderBottomWidth: StyleSheet.hairlineWidth },
              ]}
              onPress={() => router.push("/you/sessions" as any)}
              activeOpacity={0.7}
            >
              <View style={[styles.settingIcon, { backgroundColor: T.surfaceHover }]}>
                <Devices size={15} color={T.text} weight="regular" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.settingLabel, { color: T.textBright }]}>Sessions</Text>
                <Text style={[styles.settingSub, { color: T.textDim }]}>
                  {sessionCount > 0 ? `${sessionCount} active` : "Manage devices"}
                </Text>
              </View>
              <CaretRight size={15} color={T.textDim} weight="regular" />
            </TouchableOpacity>

            <TouchableOpacity
              style={[
                styles.settingRow,
                { borderBottomColor: T.border, borderBottomWidth: StyleSheet.hairlineWidth },
              ]}
              onPress={() => router.push("/you/security" as any)}
              activeOpacity={0.7}
            >
              <View style={[styles.settingIcon, { backgroundColor: T.surfaceHover }]}>
                <ShieldCheck size={15} color={T.text} weight="regular" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.settingLabel, { color: T.textBright }]}>Security</Text>
                <Text style={[styles.settingSub, { color: T.textDim }]}>
                  Two-factor authentication
                </Text>
              </View>
              <CaretRight size={15} color={T.textDim} weight="regular" />
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.settingRow}
              activeOpacity={0.7}
              onPress={() => router.push("/you/notifications" as any)}
            >
              <View style={[styles.settingIcon, { backgroundColor: T.surfaceHover }]}>
                <Bell size={15} color={T.text} weight="regular" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.settingLabel, { color: T.textBright }]}>Notifications</Text>
                <Text style={[styles.settingSub, { color: T.textDim }]}>Manage alerts</Text>
              </View>
              <CaretRight size={15} color={T.textDim} weight="regular" />
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={[styles.sectionLabel, { color: T.textDim }]}>APP</Text>
          <View style={[styles.sectionCard, { backgroundColor: T.surface, borderColor: T.border }]}>
            <TouchableOpacity
              style={[
                styles.settingRow,
                { borderBottomColor: T.border, borderBottomWidth: StyleSheet.hairlineWidth },
              ]}
              onPress={() => router.push("/you/appearance" as any)}
              activeOpacity={0.7}
            >
              <View style={[styles.settingIcon, { backgroundColor: T.surfaceHover }]}>
                <Moon size={15} color={T.text} weight="regular" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.settingLabel, { color: T.textBright }]}>Appearance</Text>
                <Text style={[styles.settingSub, { color: T.textDim }]}>
                  Theme, colors & chat layout
                </Text>
              </View>
              <CaretRight size={15} color={T.textDim} weight="regular" />
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.settingRow}
              onPress={() => router.push("/you/calls" as Href)}
              activeOpacity={0.7}
            >
              <View style={[styles.settingIcon, { backgroundColor: T.surfaceHover }]}>
                <Phone size={15} color={T.text} weight="regular" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.settingLabel, { color: T.textBright }]}>Calls</Text>
                <Text style={[styles.settingSub, { color: T.textDim }]}>
                  Ringtone, camera and join defaults
                </Text>
              </View>
              <CaretRight size={15} color={T.textDim} weight="regular" />
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={[styles.sectionLabel, { color: T.textDim }]}>ABOUT</Text>
          <View style={[styles.sectionCard, { backgroundColor: T.surface, borderColor: T.border }]}>
            <TouchableOpacity
              style={[
                styles.settingRow,
                { borderBottomColor: T.border, borderBottomWidth: StyleSheet.hairlineWidth },
              ]}
              activeOpacity={0.7}
            >
              <View style={[styles.settingIcon, { backgroundColor: T.surfaceHover }]}>
                <Question size={15} color={T.text} weight="regular" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.settingLabel, { color: T.textBright }]}>Help & Docs</Text>
              </View>
              <CaretRight size={15} color={T.textDim} weight="regular" />
            </TouchableOpacity>

            <TouchableOpacity
              style={[
                styles.settingRow,
                { borderBottomColor: T.border, borderBottomWidth: StyleSheet.hairlineWidth },
              ]}
              activeOpacity={0.7}
            >
              <View style={[styles.settingIcon, { backgroundColor: T.surfaceHover }]}>
                <ChatText size={15} color={T.text} weight="regular" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.settingLabel, { color: T.textBright }]}>Send Feedback</Text>
              </View>
              <CaretRight size={15} color={T.textDim} weight="regular" />
            </TouchableOpacity>

            <TouchableOpacity style={styles.settingRow} activeOpacity={0.7}>
              <View style={[styles.settingIcon, { backgroundColor: T.surfaceHover }]}>
                <Info size={15} color={T.text} weight="regular" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.settingLabel, { color: T.textBright }]}>About Uniffy</Text>
                <Text style={[styles.settingSub, { color: T.textDim }]}>v1.0.0</Text>
              </View>
              <CaretRight size={15} color={T.textDim} weight="regular" />
            </TouchableOpacity>
          </View>
        </View>

        <TouchableOpacity
          style={[styles.signOutBtn, { borderColor: "#FA525240" }]}
          onPress={() => void signOut()}
          disabled={signingOut}
          activeOpacity={0.7}
        >
          <SignOut size={15} color="#FA5252" weight="regular" />
          <Text style={styles.signOutText}>{signingOut ? "Signing out..." : "Sign out"}</Text>
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  profileHeader: {
    alignItems: "center",
    gap: 14,
    paddingHorizontal: 16,
    paddingBottom: 24,
  },
  profileName: {
    fontSize: 22,
    fontFamily: FONT.bold,
  },
  profileEmail: {
    fontSize: 13,
    fontFamily: FONT.regular,
  },
  section: {
    paddingHorizontal: 16,
    paddingTop: 16,
    gap: 8,
  },
  sectionLabel: {
    fontSize: 11,
    fontFamily: FONT.semibold,
    letterSpacing: 0.8,
  },
  sectionCard: {
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: "hidden",
  },
  settingRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 12,
  },
  settingIcon: {
    width: 30,
    height: 30,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  settingLabel: {
    fontSize: 14,
    fontFamily: FONT.medium,
  },
  settingSub: {
    fontSize: 12,
    fontFamily: FONT.regular,
    marginTop: 1,
  },
  signOutBtn: {
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
  signOutText: {
    fontSize: 15,
    fontFamily: FONT.medium,
    color: "#FA5252",
  },
});
