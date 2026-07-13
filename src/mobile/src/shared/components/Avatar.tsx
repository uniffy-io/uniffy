import React from "react";
import { View, Text, Image, StyleSheet } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { FONT } from "@theme/typography";
import { PresenceDot } from "@shared/presence/PresenceDot";

const GRADIENT_PAIRS: [string, string][] = [
  ["#7C5CFC", "#E64980"],
  ["#3b82f6", "#06b6d4"],
  ["#f43f5e", "#f97316"],
  ["#8b5cf6", "#ec4899"],
  ["#10b981", "#14b8a6"],
  ["#f59e0b", "#ef4444"],
  ["#6366f1", "#818cf8"],
  ["#0ea5e9", "#7c3aed"],
];

function hashName(name: string): number {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = (hash * 31 + name.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }
  return (parts[0]?.[0] ?? "?").toUpperCase();
}

function getGradient(name: string): [string, string] {
  return GRADIENT_PAIRS[hashName(name) % GRADIENT_PAIRS.length];
}

type AvatarProps = {
  name: string;
  avatarUrl?: string;
  size?: number;
  accentColor?: string;
  /** Emoji fallback (agent avatars) - beats initials when there is no image. */
  emoji?: string;
  /** Presence status string ("online", "away", ...) - renders a corner dot. */
  presence?: string | null;
  presenceRingColor?: string;
};

export function Avatar({
  name,
  avatarUrl,
  size = 32,
  accentColor,
  emoji,
  presence,
  presenceRingColor,
}: AvatarProps) {
  const fontSize = size * 0.35;
  const borderRadius = size * 0.25;

  if (presence) {
    return (
      <View style={{ width: size, height: size }}>
        <Avatar
          name={name}
          avatarUrl={avatarUrl}
          size={size}
          accentColor={accentColor}
          emoji={emoji}
        />
        <PresenceDot
          status={presence}
          size={Math.max(10, Math.round(size * 0.3))}
          ringColor={presenceRingColor}
        />
      </View>
    );
  }

  if (avatarUrl) {
    return (
      <Image source={{ uri: avatarUrl }} style={{ width: size, height: size, borderRadius }} />
    );
  }

  if (emoji) {
    return (
      <View
        style={[
          styles.container,
          {
            width: size,
            height: size,
            borderRadius,
            backgroundColor: accentColor ? accentColor + "22" : "rgba(128,128,128,0.15)",
          },
        ]}
      >
        <Text style={{ fontSize: size * 0.55, lineHeight: size }}>{emoji}</Text>
      </View>
    );
  }

  const initials = getInitials(name);

  if (accentColor) {
    return (
      <View
        style={[
          styles.container,
          { width: size, height: size, borderRadius, backgroundColor: accentColor },
        ]}
      >
        <Text style={[styles.initials, { fontSize, lineHeight: size }]}>{initials}</Text>
      </View>
    );
  }

  const [start, end] = getGradient(name);

  return (
    <LinearGradient
      colors={[start, end]}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={[styles.container, { width: size, height: size, borderRadius }]}
    >
      <Text style={[styles.initials, { fontSize, lineHeight: size }]}>{initials}</Text>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: "center",
    justifyContent: "center",
  },
  initials: {
    color: "#fff",
    fontFamily: FONT.semibold,
    textAlignVertical: "center",
  },
});
