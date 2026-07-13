import React, { useEffect, useMemo, useState } from "react";
import { View, Text, TouchableOpacity, StyleSheet, Platform } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Animated, { useAnimatedStyle } from "react-native-reanimated";
import { useReanimatedKeyboardAnimation } from "react-native-keyboard-controller";
import * as Haptics from "expo-haptics";
import { Phone, Microphone, MicrophoneSlash, PhoneDisconnect } from "phosphor-react-native";
import { useCall } from "@features/calls/call-context";
import { useChannels } from "@features/chat/useChat";
import { formatCallDuration } from "@features/calls/callsSerializer";
import { BOTTOM_BAR_CONTENT_HEIGHT, bottomBarPadding } from "@shared/components/BottomNav";
import { useTheme } from "@shared/hooks/useTheme";
import { FONT } from "@theme/typography";

export function CallDock() {
  const T = useTheme();
  const insets = useSafeAreaInsets();
  const { session, minimized, setMinimized, toggleMic, leaveCall } = useCall();
  const { channels } = useChannels();
  const { progress: keyboardProgress } = useReanimatedKeyboardAnimation();
  const [nowMs, setNowMs] = useState(() => Date.now());

  const visible =
    minimized && (session.status === "connected" || session.status === "reconnecting");

  useEffect(() => {
    if (!visible) return;
    const timer = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [visible]);

  const title = useMemo(() => {
    const channel = channels.find((c) => c.id === session.channelId);
    return channel ? channel.customName || channel.name || "Live call" : "Live call";
  }, [channels, session.channelId]);

  const hideStyle = useAnimatedStyle(() => ({
    opacity: 1 - keyboardProgress.value,
    transform: [{ translateY: keyboardProgress.value * 80 }],
  }));

  if (!visible) return null;

  const barSpace = BOTTOM_BAR_CONTENT_HEIGHT + bottomBarPadding(insets.bottom);
  const status =
    session.status === "reconnecting"
      ? "Reconnecting..."
      : formatCallDuration(nowMs - session.connectedAtMs);

  return (
    <Animated.View
      style={[styles.wrap, { bottom: barSpace + 10 }, hideStyle]}
      pointerEvents="box-none"
    >
      <TouchableOpacity
        style={[styles.dock, { backgroundColor: T.surface, borderColor: T.green }]}
        onPress={() => setMinimized(false)}
        activeOpacity={0.85}
        accessibilityRole="button"
        accessibilityLabel="Return to call"
      >
        <View style={[styles.liveDot, { backgroundColor: T.green }]}>
          <Phone size={13} color="#ffffff" weight="fill" />
        </View>
        <View style={styles.labels}>
          <Text style={[styles.title, { color: T.textBright }]} numberOfLines={1}>
            {title}
          </Text>
          <Text style={[styles.status, { color: T.textDim }]}>{status}</Text>
        </View>
        <TouchableOpacity
          style={[styles.action, { borderColor: T.border }]}
          onPress={() => {
            if (Platform.OS !== "web") Haptics.selectionAsync().catch(() => {});
            void toggleMic();
          }}
          hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
          accessibilityRole="button"
          accessibilityLabel={session.micEnabled ? "Mute microphone" : "Unmute microphone"}
        >
          {session.micEnabled ? (
            <Microphone size={16} color={T.green} weight="fill" />
          ) : (
            <MicrophoneSlash size={16} color={T.red} weight="fill" />
          )}
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.action, { borderColor: T.border }]}
          onPress={() => void leaveCall()}
          hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
          accessibilityRole="button"
          accessibilityLabel="Leave call"
        >
          <PhoneDisconnect size={16} color={T.red} weight="fill" />
        </TouchableOpacity>
      </TouchableOpacity>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: "absolute",
    left: 14,
    right: 14,
    zIndex: 190,
    alignItems: "center",
  },
  dock: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderRadius: 22,
    borderWidth: 1,
    paddingVertical: 8,
    paddingHorizontal: 12,
    width: "100%",
    maxWidth: 480,
    shadowColor: "#000",
    shadowOpacity: 0.25,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  liveDot: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  labels: { flex: 1, minWidth: 0 },
  title: { fontSize: 13, fontFamily: FONT.semibold },
  status: { fontSize: 11, fontFamily: FONT.regular, marginTop: 1 },
  action: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: "center",
    justifyContent: "center",
  },
});
