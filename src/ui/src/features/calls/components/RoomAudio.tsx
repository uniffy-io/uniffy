import { useEffect, useRef } from "react";
import { Track } from "livekit-client";
import type { Participant, Room } from "livekit-client";
import { useRoomParticipants } from "@/features/calls/hooks/useRoomParticipants";

function ParticipantAudio({ participant }: { participant: Participant }) {
  const micRef = useRef<HTMLAudioElement>(null);
  const screenRef = useRef<HTMLAudioElement>(null);
  const micTrack = participant.getTrackPublication(Track.Source.Microphone)?.track;
  const screenAudioTrack = participant.getTrackPublication(Track.Source.ScreenShareAudio)?.track;

  useEffect(() => {
    const el = micRef.current;
    if (!el || !micTrack) return;
    micTrack.attach(el);
    return () => {
      micTrack.detach(el);
    };
  }, [micTrack]);

  useEffect(() => {
    const el = screenRef.current;
    if (!el || !screenAudioTrack) return;
    screenAudioTrack.attach(el);
    return () => {
      screenAudioTrack.detach(el);
    };
  }, [screenAudioTrack]);

  return (
    <>
      <audio ref={micRef} autoPlay />
      <audio ref={screenRef} autoPlay />
    </>
  );
}

/**
 * Mounted globally (not inside CallView) so call audio keeps playing when the
 * user navigates away from the source channel.
 */
export function RoomAudio({ room }: { room: Room | null }) {
  const participants = useRoomParticipants(room);
  return (
    <>
      {participants
        .filter((p) => !p.isLocal)
        .map((p) => (
          <ParticipantAudio key={p.identity} participant={p} />
        ))}
    </>
  );
}
