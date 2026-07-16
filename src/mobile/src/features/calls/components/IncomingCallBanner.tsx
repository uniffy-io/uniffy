import React, { useEffect, useMemo, useState } from "react";
import { View, Text, TouchableOpacity, StyleSheet, Platform } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQueryClient } from "@tanstack/react-query";
import { useAudioPlayer } from "expo-audio";
import * as Haptics from "expo-haptics";
import { Phone, PhoneSlash } from "phosphor-react-native";
import { useCall } from "@features/calls/CallContext";
import { useAuth } from "@core/providers/AuthContext";
import { useRingInvites, dismissRingInvite } from "@features/calls/useCallsState";
import { useRingtoneEnabled } from "@features/calls/callPrefs";
import { callsApi } from "@features/calls/callsApi";
import type { RingInvite } from "@features/calls/callsSerializer";
import { Avatar } from "@shared/components/Avatar";
import { PreJoinSheet } from "@features/calls/components/PreJoinSheet";
import { useTheme } from "@shared/hooks/useTheme";
import { FONT } from "@theme/typography";

const HAPTIC_PULSE_MS = 2000;

export function IncomingCallBanner() {
  const T = useTheme();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const { organizationId } = useAuth();
  const { session, available } = useCall();
  const invites = useRingInvites();
  const [ringtoneEnabled] = useRingtoneEnabled();
  const [nowSeconds, setNowSeconds] = useState(() => Math.floor(Date.now() / 1000));
  const [accepted, setAccepted] = useState<RingInvite | null>(null);

  const player = useAudioPlayer(require("../../../../assets/sounds/ringtone.wav"));

  const live = useMemo(
    () => invites.filter((invite) => invite.expiresAtSeconds > nowSeconds),
    [invites, nowSeconds],
  );

  useEffect(() => {
    if (invites.length === 0) return;
    const timer = setInterval(() => setNowSeconds(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(timer);
  }, [invites.length]);

  // Prune expired invites from the cache so counts stay honest.
  useEffect(() => {
    if (!organizationId) return;
    for (const invite of invites) {
      if (invite.expiresAtSeconds <= nowSeconds) {
        dismissRingInvite(queryClient, organizationId, invite.callId);
      }
    }
  }, [invites, nowSeconds, organizationId, queryClient]);

  const shouldRing = live.length > 0 && session.status === "idle" && ringtoneEnabled && available;

  useEffect(() => {
    if (!shouldRing) {
      player.pause();
      return;
    }
    // expo-audio's AudioPlayer is a mutable native handle; `loop` has no
    // constructor option, so assigning the property is the intended API.
    // eslint-disable-next-line react-hooks/immutability
    player.loop = true;
    void player.seekTo(0);
    player.play();
    const haptic =
      Platform.OS === "web"
        ? null
        : setInterval(() => {
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
          }, HAPTIC_PULSE_MS);
    return () => {
      player.pause();
      if (haptic) clearInterval(haptic);
    };
  }, [shouldRing, player]);

  const decline = (invite: RingInvite) => {
    if (organizationId) {
      dismissRingInvite(queryClient, organizationId, invite.callId);
      callsApi.declineCall({ organizationId, callId: invite.callId }).catch(() => {});
    }
  };

  const accept = (invite: RingInvite) => {
    if (organizationId) dismissRingInvite(queryClient, organizationId, invite.callId);
    setAccepted(invite);
  };

  if (!available) return null;

  return (
    <>
      {live.length > 0 ? (
        <View style={[styles.wrap, { top: insets.top + 8 }]} pointerEvents="box-none">
          {live.map((invite) => (
            <View
              key={invite.callId}
              style={[styles.card, { backgroundColor: T.surface, borderColor: T.border }]}
            >
              <Avatar
                name={invite.callerName}
                avatarUrl={invite.callerAvatarUrl ?? undefined}
                size={38}
              />
              <View style={styles.labels}>
                <Text style={[styles.caller, { color: T.textBright }]} numberOfLines={1}>
                  {invite.callerName}
                </Text>
                <Text style={[styles.channel, { color: T.textDim }]} numberOfLines={1}>
                  {invite.callType === "DIRECT" ? "Incoming call" : invite.channelName}
                </Text>
              </View>
              <TouchableOpacity
                style={[styles.roundButton, { backgroundColor: T.red }]}
                onPress={() => decline(invite)}
                accessibilityRole="button"
                accessibilityLabel="Decline call"
              >
                <PhoneSlash size={18} color="#ffffff" weight="fill" />
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.roundButton, { backgroundColor: T.green }]}
                onPress={() => accept(invite)}
                accessibilityRole="button"
                accessibilityLabel="Accept call"
              >
                <Phone size={18} color="#ffffff" weight="fill" />
              </TouchableOpacity>
            </View>
          ))}
        </View>
      ) : null}
      {accepted ? (
        <PreJoinSheet
          visible
          T={T}
          channelId={accepted.channelId}
          channelName={accepted.channelName}
          callId={accepted.callId}
          onClose={() => setAccepted(null)}
        />
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  // No zIndex: sibling order in _layout stacks the banner, and zIndex on an
  // inset-positioned view risks the iOS 26 Fabric flow-layout fallback.
  wrap: {
    position: "absolute",
    left: 14,
    right: 14,
    gap: 8,
    alignItems: "center",
  },
  card: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderRadius: 18,
    borderWidth: 1,
    paddingVertical: 10,
    paddingHorizontal: 14,
    width: "100%",
    maxWidth: 480,
    shadowColor: "#000",
    shadowOpacity: 0.3,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 5 },
    elevation: 8,
  },
  labels: { flex: 1, minWidth: 0 },
  caller: { fontSize: 14, fontFamily: FONT.semibold },
  channel: { fontSize: 12, fontFamily: FONT.regular, marginTop: 1 },
  roundButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
  },
});
