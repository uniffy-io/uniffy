import React, { useEffect, useState } from "react";
import { View, StyleSheet } from "react-native";
import { useTheme } from "@shared/hooks/useTheme";
import { Avatar } from "@shared/components/Avatar";
import type { DocSession } from "@shared/realtime/useDocSession";
import type { RealtimeStatus } from "@shared/realtime/protocol";

type PeerIdentity = {
  key: string;
  name: string;
  avatarUrl: string | null;
};

type AwarenessUserPayload = {
  id?: string | null;
  name?: string;
  hasAvatar?: boolean;
};

const MAX_VISIBLE_PEERS = 3;

function readPeers(session: DocSession): PeerIdentity[] {
  const peers: PeerIdentity[] = [];
  const seen = new Set<string>();
  for (const [clientId, state] of session.awareness.getStates()) {
    if (clientId === session.awareness.clientID) continue;
    const user = (state as { user?: AwarenessUserPayload }).user;
    if (!user?.name) continue;
    // A refreshed peer's stale awareness entry lingers until the 30s GC;
    // dedupe by identity so one person never shows twice.
    const key = user.id ?? `client-${clientId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    peers.push({
      key,
      name: user.name,
      // Never render a wire-supplied URL: the awareness relay is blind, so a
      // hostile peer could point it anywhere and the Avatar fetch would ship
      // the viewer's asset credential there. Derive from the asserted id.
      avatarUrl: user.hasAvatar && user.id ? `/api/avatars/${user.id}/sm?_v=2` : null,
    });
  }
  return peers;
}

/** Live/offline dot plus the deduped stack of peers in the same note doc. */
export function RealtimePresence({
  session,
  status,
}: {
  session: DocSession | null;
  status: RealtimeStatus;
}) {
  const T = useTheme();
  const [peers, setPeers] = useState<PeerIdentity[]>(() => (session ? readPeers(session) : []));
  // Render-time reset on session swap so a new doc never shows the old doc's peers.
  const [prevSession, setPrevSession] = useState(session);
  if (prevSession !== session) {
    setPrevSession(session);
    setPeers(session ? readPeers(session) : []);
  }

  useEffect(() => {
    if (!session) return;
    const update = () => setPeers(readPeers(session));
    session.awareness.on("change", update);
    return () => {
      session.awareness.off("change", update);
    };
  }, [session]);

  if (!session) return null;

  const live = status === "connected";
  const dotColor = status === "connecting" ? T.yellow : live ? T.green : T.red;
  const visible = peers.slice(0, MAX_VISIBLE_PEERS);

  return (
    <View style={styles.row}>
      {visible.map((peer, i) => (
        <View
          key={peer.key}
          style={[styles.peerWrap, { borderColor: T.pageBg, marginLeft: i === 0 ? 0 : -8 }]}
        >
          <Avatar name={peer.name} avatarUrl={peer.avatarUrl ?? undefined} size={22} circle />
        </View>
      ))}
      <View style={[styles.dot, { backgroundColor: dotColor }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
  },
  peerWrap: {
    borderWidth: 1.5,
    borderRadius: 13,
    overflow: "hidden",
  },
  dot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
});
