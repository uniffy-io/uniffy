import { canPublishInCall } from "@/features/calls/utils/callPublishing";
import { useState } from "react";
import { MicrophoneSlash, UserMinus, Microphone, Ear } from "@phosphor-icons/react";
import { useAppDispatch, useAppSelector } from "@/app/hooks";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Modal, ModalBody, ModalFooter, ModalHeader } from "@/components/ui/modal";
import { PaneIconButton } from "@/components/ui/pane-header";
import { CallPersonRow } from "@/features/calls/components/CallPersonRow";
import { useCall } from "@/features/calls/components/callContext";
import { useRoomParticipants } from "@/features/calls/hooks/useRoomParticipants";
import { useCallModeration } from "@/features/calls/hooks/useCallModeration";
import { selectSessionCall } from "@/features/calls/store/callsSlice";
import {
  kickParticipant,
  muteParticipant,
  setCallSpeaker,
} from "@/features/calls/store/callsThunks";

export function CallParticipants({ onClose }: { onClose: () => void }) {
  "use no memo";
  const dispatch = useAppDispatch();
  const { room } = useCall();
  const call = useAppSelector(selectSessionCall);
  const participants = useRoomParticipants(room);
  const canModerate = useCallModeration();
  const [pending, setPending] = useState<string | null>(null);
  const [remove, setRemove] = useState<{ identity: string; name: string } | null>(null);
  const act = async (identity: string, kick: boolean) => {
    if (!call || pending) return;
    setPending(identity);
    try {
      await dispatch(
        (kick ? kickParticipant : muteParticipant)({ callId: call.id, identity }),
      ).unwrap();
      setRemove(null);
    } catch {
      // Rejected thunks use the shared error pipeline.
    } finally {
      setPending(null);
    }
  };
  return (
    <>
      <Modal onClose={onClose} maxWidth="max-w-lg">
        <ModalHeader
          title={`In this call (${participants.length})`}
          description="Microphone, speaking and screen sharing status"
        />
        <ModalBody>
          <ul data-testid="call-participant-roster">
            {participants.map((participant) => {
              const row = call?.participants.find((p) => p.identity === participant.identity);
              const name = row?.displayName || participant.name || "Participant";
              const speaker = canPublishInCall(
                call,
                row?.userId ?? participant.identity.split(":")[0],
              );
              const state = [
                call?.townHall ? (speaker ? "Speaker" : "Audience") : null,
                participant.isMicrophoneEnabled ? "Microphone on" : "Muted",
                participant.isSpeaking ? "Speaking" : null,
                participant.isScreenShareEnabled ? "Sharing screen" : null,
              ]
                .filter(Boolean)
                .join(", ");
              return (
                <CallPersonRow
                  key={participant.identity}
                  userId={row?.userId ?? participant.identity.split(":")[0]}
                  name={name}
                  avatarUrl={row?.avatarUrl}
                  label={`${name}${participant.isLocal ? " (you)" : ""}${row?.userId === call?.hostUserId ? " · Host" : ""}`}
                  state={state}
                >
                  {canModerate && !participant.isLocal && (
                    <>
                      {call?.townHall && row && row.userId !== call.hostUserId && (
                        <PaneIconButton
                          disabled={pending !== null}
                          title={speaker ? "Move to audience" : "Allow to speak"}
                          aria-label={
                            speaker ? `Move ${name} to audience` : `Allow ${name} to speak`
                          }
                          onClick={async () => {
                            setPending(participant.identity);
                            try {
                              await dispatch(
                                setCallSpeaker({
                                  callId: call.id,
                                  userId: row.userId,
                                  speaker: !speaker,
                                }),
                              ).unwrap();
                            } catch {
                              /* Shared thunk pipeline reports failures. */
                            } finally {
                              setPending(null);
                            }
                          }}
                        >
                          {speaker ? <Ear size={16} /> : <Microphone size={16} />}
                        </PaneIconButton>
                      )}
                      <PaneIconButton
                        disabled={pending !== null || !participant.isMicrophoneEnabled}
                        title="Mute"
                        aria-label={`Mute ${name}`}
                        onClick={() => void act(participant.identity, false)}
                      >
                        <MicrophoneSlash size={16} />
                      </PaneIconButton>
                      <PaneIconButton
                        className="hover:bg-destructive/10 hover:text-destructive"
                        disabled={pending !== null}
                        title="Remove from call"
                        aria-label={`Remove ${name} from call`}
                        onClick={() => setRemove({ identity: participant.identity, name })}
                      >
                        <UserMinus size={16} />
                      </PaneIconButton>
                    </>
                  )}
                </CallPersonRow>
              );
            })}
          </ul>
        </ModalBody>
        <ModalFooter>
          <Button autoFocus variant="ghost" onClick={onClose}>
            Close
          </Button>
        </ModalFooter>
      </Modal>
      <ConfirmDialog
        isOpen={remove !== null}
        onClose={() => setRemove(null)}
        onConfirm={() => {
          if (remove) void act(remove.identity, true);
        }}
        title="Remove participant?"
        message={`${remove?.name ?? "Participant"} will leave this call.`}
        confirmLabel="Remove"
        loading={pending !== null}
      />
    </>
  );
}
