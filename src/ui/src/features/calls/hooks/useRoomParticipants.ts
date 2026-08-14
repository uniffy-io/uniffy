import { useEffect, useReducer } from "react";
import { RoomEvent } from "livekit-client";
import type { Participant, Room } from "livekit-client";

const RERENDER_EVENTS = [
  RoomEvent.ParticipantConnected,
  RoomEvent.ParticipantDisconnected,
  RoomEvent.TrackSubscribed,
  RoomEvent.TrackUnsubscribed,
  RoomEvent.TrackMuted,
  RoomEvent.TrackUnmuted,
  RoomEvent.LocalTrackPublished,
  RoomEvent.LocalTrackUnpublished,
  RoomEvent.ActiveSpeakersChanged,
  RoomEvent.ConnectionQualityChanged,
  RoomEvent.ParticipantMetadataChanged,
  RoomEvent.ConnectionStateChanged,
] as const;

/**
 * Participants derived straight from the Room on every relevant SDK event.
 * The local participant is always first.
 */
export function useRoomParticipants(room: Room | null): Participant[] {
  const [, bump] = useReducer((x: number) => x + 1, 0);

  useEffect(() => {
    if (!room) return;
    const onEvent = () => bump();
    RERENDER_EVENTS.forEach((e) => room.on(e, onEvent));
    // Catch anything that fired between render and subscription.
    queueMicrotask(onEvent);
    return () => {
      RERENDER_EVENTS.forEach((e) => room.off(e, onEvent));
    };
  }, [room]);

  if (!room) return [];
  return [room.localParticipant, ...Array.from(room.remoteParticipants.values())];
}
