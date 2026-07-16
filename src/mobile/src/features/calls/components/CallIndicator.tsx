import React, { useEffect, useMemo, useState } from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import { Phone, CaretUp } from "phosphor-react-native";
import { GlassSurface } from "@shared/components/GlassSurface";
import { useCall } from "@features/calls/CallContext";
import { useChannels } from "@features/chat/useChat";
import { formatCallDuration } from "@features/calls/callsSerializer";
import { useTheme } from "@shared/hooks/useTheme";
import { FONT } from "@theme/typography";

// Flow banner above the bottom bar while a call runs minimized; tapping it
// expands the call screen.
export function CallIndicator() {
  const T = useTheme();
  const { session, minimized, setMinimized } = useCall();
  const { channels } = useChannels();
  const [nowMs, setNowMs] = useState(() => Date.now());

  const visible =
    minimized &&
    (session.status === "connecting" ||
      session.status === "connected" ||
      session.status === "reconnecting");

  useEffect(() => {
    if (!visible) return;
    const timer = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [visible]);

  const title = useMemo(() => {
    const channel = channels.find((c) => c.id === session.channelId);
    return channel ? channel.customName || channel.name || "Live call" : "Live call";
  }, [channels, session.channelId]);

  if (!visible) return null;

  const status =
    session.status === "connecting"
      ? "Connecting..."
      : session.status === "reconnecting"
        ? "Reconnecting..."
        : formatCallDuration(nowMs - session.connectedAtMs);

  return (
    // Pressable, not TouchableOpacity: the touchable's animated opacity is an
    // animated ancestor of the GlassSurface and silently degrades it to its
    // solid fill (expo/expo#41024). Press feedback comes from the border.
    <Pressable
      style={({ pressed }) => [styles.row, { borderColor: pressed ? T.textDim : T.green }]}
      onPress={() => setMinimized(false)}
      accessibilityRole="button"
      accessibilityLabel="Return to call"
    >
      <GlassSurface
        style={StyleSheet.absoluteFill}
        tintColor={T.isDark ? "rgba(20,22,34,0.22)" : "rgba(255,255,255,0.35)"}
        isDark={T.isDark}
        blurIntensity={48}
        solidColor={T.surface}
      />
      <View style={[styles.liveDot, { backgroundColor: T.green }]}>
        <Phone size={12} color="#ffffff" weight="fill" />
      </View>
      <Text style={[styles.title, { color: T.textBright }]} numberOfLines={1}>
        {title}
      </Text>
      <Text style={[styles.status, { color: T.green }]}>{status}</Text>
      <CaretUp size={14} color={T.textDim} weight="bold" />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginHorizontal: 14,
    marginBottom: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 16,
    borderWidth: 1,
    overflow: "hidden",
  },
  liveDot: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  title: { flex: 1, fontSize: 13, fontFamily: FONT.semibold },
  status: { fontSize: 12, fontFamily: FONT.medium, fontVariant: ["tabular-nums"] },
});
