import React from "react";
import { View, TouchableOpacity, Text, StyleSheet, Platform } from "react-native";
import { NotePencil, FolderSimple, ChatCircle, CalendarBlank, Kanban } from "phosphor-react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { usePathname, router } from "expo-router";
import { useTheme } from "@/hooks/useTheme";
import { DOMAIN_COLORS } from "@/constants/theme";

type Tab = {
  key: string;
  label: string;
  path: string;
  color: string;
  Icon: React.ComponentType<{ size: number; color: string; weight: "duotone" }>;
};

const TABS: Tab[] = [
  { key: "notes", label: "Notes", path: "/notes", color: DOMAIN_COLORS.notes, Icon: NotePencil },
  { key: "files", label: "Files", path: "/files", color: DOMAIN_COLORS.files, Icon: FolderSimple },
  { key: "chat", label: "Chat", path: "/chat", color: DOMAIN_COLORS.chat, Icon: ChatCircle },
  {
    key: "calendar",
    label: "Calendar",
    path: "/calendar",
    color: DOMAIN_COLORS.calendar,
    Icon: CalendarBlank,
  },
  {
    key: "projects",
    label: "Projects",
    path: "/projects",
    color: DOMAIN_COLORS.projects,
    Icon: Kanban,
  },
];

export function BottomNav() {
  const insets = useSafeAreaInsets();
  const T = useTheme();
  const pathname = usePathname();

  const bottomPad = Platform.OS === "web" ? 34 : insets.bottom;

  function getActiveTab(): string | null {
    for (const tab of TABS) {
      if (pathname.startsWith(tab.path)) return tab.key;
    }
    return null;
  }

  const activeTab = getActiveTab();

  return (
    <View
      style={[
        styles.container,
        {
          backgroundColor: T.surface,
          borderTopColor: T.border,
          paddingBottom: bottomPad,
        },
      ]}
    >
      {TABS.map((tab) => {
        const isActive = activeTab === tab.key;
        const color = isActive ? tab.color : T.textDim;
        return (
          <TouchableOpacity
            key={tab.key}
            style={styles.tab}
            onPress={() => router.push(tab.path as any)}
            activeOpacity={0.7}
          >
            <View style={styles.iconWrap}>
              <tab.Icon size={21} color={color} weight="duotone" />
            </View>
            <Text style={[styles.label, { color }]}>{tab.label}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: "row",
    alignItems: "center",
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: 8,
    zIndex: 200,
  },
  tab: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 3,
    paddingBottom: 4,
  },
  iconWrap: {
    width: 24,
    height: 24,
    alignItems: "center",
    justifyContent: "center",
  },
  label: {
    fontSize: 10,
    fontFamily: "Inter_500Medium",
    letterSpacing: 0.2,
  },
});
