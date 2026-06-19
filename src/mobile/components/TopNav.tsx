import React from "react";
import { View, Text, Image, TouchableOpacity, StyleSheet, Platform } from "react-native";
import { BlurView } from "expo-blur";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router } from "expo-router";
import { useTheme } from "@/hooks/useTheme";
import { Avatar } from "@/components/Avatar";
import { useAuth } from "@/context/auth-context";
import { useUniffy } from "@/context/uniffy-context";
import { At, MagnifyingGlass, BookmarkSimple, BellSimple } from "phosphor-react-native";
import { useUnreadNotificationCount } from "@/hooks/useNotifications";

export const TOP_NAV_CONTENT_HEIGHT = 44;

export function TopNav() {
  const insets = useSafeAreaInsets();
  const T = useTheme();
  const isDark = T.isDark;
  const topPad = Platform.OS === "web" ? 20 : insets.top;
  const { user } = useAuth();
  const { atPosition, atOpen, openAt, closeAt } = useUniffy();
  const unreadQuery = useUnreadNotificationCount();
  const unread = unreadQuery.data ?? 0;

  const handleAtPress = () => {
    if (atOpen) {
      closeAt();
    } else {
      openAt(false);
    }
  };

  return (
    <BlurView
      intensity={80}
      tint={isDark ? "dark" : "light"}
      style={[
        styles.container,
        {
          borderBottomColor: T.border,
          paddingTop: topPad,
          height: topPad + TOP_NAV_CONTENT_HEIGHT,
        },
      ]}
    >
      {/* Left: logo */}
      <TouchableOpacity
        onPress={() => router.push("/" as any)}
        style={styles.side}
        activeOpacity={0.7}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 16 }}
      >
        <Image
          source={
            isDark
              ? require("../assets/images/uniffy-logo.png")
              : require("../assets/images/uniffy-logo-dark.png")
          }
          style={styles.logoMark}
          resizeMode="contain"
        />
        <Text style={[styles.logoText, { color: T.textBright }]}>Uniffy</Text>
      </TouchableOpacity>

      {/* Center: @ button (only in topnav mode) */}
      <View style={styles.center}>
        {atPosition === "topnav" && (
          <TouchableOpacity
            style={[
              styles.atBtn,
              {
                backgroundColor: atOpen ? T.accent : T.surfaceHover,
                borderColor: atOpen ? T.accent : T.border,
              },
            ]}
            onPress={handleAtPress}
            activeOpacity={0.8}
          >
            <At size={17} color={atOpen ? "#fff" : T.accent} weight="bold" />
          </TouchableOpacity>
        )}
      </View>

      {/* Right: search, bookmarks, avatar */}
      <View style={[styles.side, styles.sideRight]}>
        <TouchableOpacity
          onPress={() => router.push("/search" as any)}
          activeOpacity={0.7}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <MagnifyingGlass size={20} color={T.text} weight="bold" />
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => router.push("/bookmarks" as any)}
          activeOpacity={0.7}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <BookmarkSimple size={20} color={T.text} weight="regular" />
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => router.push("/notifications" as any)}
          activeOpacity={0.7}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <View>
            <BellSimple size={20} color={T.text} weight="regular" />
            {unread > 0 && (
              <View style={[styles.badge, { backgroundColor: T.red, borderColor: T.bg }]}>
                <Text style={styles.badgeText}>{unread > 9 ? "9+" : unread}</Text>
              </View>
            )}
          </View>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => router.push("/you" as any)}
          activeOpacity={0.7}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Avatar
            name={user?.fullName || user?.username || "User"}
            avatarUrl={user?.avatarUrl}
            size={30}
            accentColor={T.accent}
          />
        </TouchableOpacity>
      </View>
    </BlurView>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: "row",
    alignItems: "flex-end",
    paddingHorizontal: 16,
    paddingBottom: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  side: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  sideRight: {
    justifyContent: "flex-end",
  },
  center: {
    alignItems: "center",
    justifyContent: "center",
  },
  logoMark: {
    width: 26,
    height: 26,
    borderRadius: 4,
  },
  logoText: {
    fontSize: 17,
    fontFamily: "Inter_700Bold",
  },
  atBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1.5,
  },
  badge: {
    position: "absolute",
    top: -5,
    right: -6,
    minWidth: 15,
    height: 15,
    borderRadius: 7.5,
    paddingHorizontal: 3,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1.5,
  },
  badgeText: { color: "#fff", fontSize: 9, fontFamily: "Inter_700Bold" },
});
