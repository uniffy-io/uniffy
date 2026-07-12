import { useEffect, useReducer } from "react";
import type { Participant, Room, RoomEvent } from "livekit-client";
import { loadLivekitClient } from "@/lib/livekit";

const livekit = loadLivekitClient();

// Empty without livekit: a room only ever exists on clients where it loads.
const ROSTER_EVENTS: RoomEvent[] = livekit
  ? [
      livekit.RoomEvent.ParticipantConnected,
      livekit.RoomEvent.ParticipantDisconnected,
      livekit.RoomEvent.TrackSubscribed,
      livekit.RoomEvent.TrackUnsubscribed,
      livekit.RoomEvent.TrackPublished,
      livekit.RoomEvent.TrackUnpublished,
      livekit.RoomEvent.TrackMuted,
      livekit.RoomEvent.TrackUnmuted,
      livekit.RoomEvent.LocalTrackPublished,
      livekit.RoomEvent.LocalTrackUnpublished,
      livekit.RoomEvent.ActiveSpeakersChanged,
      livekit.RoomEvent.ConnectionQualityChanged,
    ]
  : [];

/** Local participant first, then remotes; re-renders on roster/track events. */
export function useRoomParticipants(room: Room | null): Participant[] {
  // livekit mutates Room/Participant objects in place, which the React
  // Compiler cannot see - without the opt-out it memoizes the roster on the
  // stable `room` identity and the UI freezes at its first render.
  "use no memo";
  const [, bump] = useReducer((x: number) => x + 1, 0);

  useEffect(() => {
    if (!room) return;
    const handler = () => bump();
    for (const event of ROSTER_EVENTS) room.on(event, handler);
    return () => {
      for (const event of ROSTER_EVENTS) room.off(event, handler);
    };
  }, [room]);

  if (!room) return [];
  return [room.localParticipant, ...Array.from(room.remoteParticipants.values())];
}
