import React, { useCallback, useRef, useState } from "react";
import { View, Text, StyleSheet } from "react-native";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { assetAuthHeaders, assetAuthStale, resolveAssetUrl } from "@core/auth/assetAuth";
import { refreshSession } from "@core/auth/refresh";
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
  // A dead avatar URL (deleted image, unrecoverable 401) falls through to
  // the emoji/gradient branches instead of leaving a blank square.
  const [imgFailed, setImgFailed] = useState(false);
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

  if (avatarUrl && !imgFailed) {
    return (
      <AvatarImage
        uri={resolveAssetUrl(avatarUrl)}
        size={size}
        borderRadius={borderRadius}
        onFail={() => setImgFailed(true)}
      />
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

function AvatarImage({
  uri,
  size,
  borderRadius,
  onFail,
}: {
  uri: string;
  size: number;
  borderRadius: number;
  onFail: () => void;
}) {
  const [bust, setBust] = useState(0);
  const retried = useRef(false);

  // One stale-auth retry per mount: refresh the tokens, then cache-bust so
  // expo-image re-fetches with the fresh Cookie header instead of the cached
  // 401. Anything else is a dead image; hand rendering back to the fallback.
  const handleError = useCallback(() => {
    if (!retried.current && assetAuthStale()) {
      retried.current = true;
      void refreshSession()
        .then((response) => {
          if (response) setBust((b) => b + 1);
          else onFail();
        })
        .catch(onFail);
      return;
    }
    onFail();
  }, [onFail]);

  const src = bust > 0 ? `${uri}${uri.includes("?") ? "&" : "?"}r=${bust}` : uri;

  return (
    <Image
      source={{ uri: src, headers: assetAuthHeaders() }}
      style={{ width: size, height: size, borderRadius }}
      cachePolicy="memory-disk"
      transition={100}
      onError={handleError}
    />
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
