import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { ChatTeardropText } from "phosphor-react-native";
import { DomainHeader } from "@/components/DomainHeader";
import { useTheme } from "@/hooks/useTheme";
import { DOMAIN_COLORS } from "@/constants/theme";

export default function ChatListScreen() {
  const T = useTheme();

  return (
    <View style={[styles.container, { backgroundColor: T.pageBg }]}>
      <DomainHeader title="Chat" color={DOMAIN_COLORS.chat} icon="chat" />

      <View style={styles.content}>
        <View style={[styles.iconWrap, { backgroundColor: DOMAIN_COLORS.chatSoft }]}>
          <ChatTeardropText size={40} color={DOMAIN_COLORS.chat} weight="duotone" />
        </View>
        <Text style={[styles.title, { color: T.textBright }]}>Chat is coming soon</Text>
        <Text style={[styles.subtitle, { color: T.textDim }]}>
          This feature is still under construction. Channels, DMs, and threads will be available
          here in a future update.
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 40,
    gap: 14,
  },
  iconWrap: {
    width: 72,
    height: 72,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 4,
  },
  title: {
    fontSize: 18,
    fontFamily: "Inter_600SemiBold",
    textAlign: "center",
  },
  subtitle: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    textAlign: "center",
    lineHeight: 21,
  },
});
