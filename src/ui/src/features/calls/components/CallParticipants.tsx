import { useState } from "react";
import { MicrophoneSlash, UserMinus } from "@phosphor-icons/react";
import { useAppDispatch, useAppSelector } from "@/app/hooks";
import { SubjectAvatar } from "@/components/subject/SubjectAvatar";
import { SUBJECT_TYPE } from "@/components/subject/types";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Modal, ModalBody, ModalFooter, ModalHeader } from "@/components/ui/modal";
import { useCall } from "@/features/calls/components/callContext";
import { useRoomParticipants } from "@/features/calls/hooks/useRoomParticipants";
import { useCallModeration } from "@/features/calls/hooks/useCallModeration";
import { selectSessionCall } from "@/features/calls/store/callsSlice";
import { kickParticipant, muteParticipant } from "@/features/calls/store/callsThunks";

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
          <ul className="space-y-1" data-testid="call-participant-roster">
            {participants.map((participant) => {
              const row = call?.participants.find((p) => p.identity === participant.identity);
              const name = row?.displayName || participant.name || "Participant";
              const state = [
                participant.isMicrophoneEnabled ? "Microphone on" : "Muted",
                participant.isSpeaking ? "Speaking" : null,
                participant.isScreenShareEnabled ? "Sharing screen" : null,
              ]
                .filter(Boolean)
                .join(", ");
              return (
                <li
                  key={participant.identity}
                  className="flex items-center gap-3 rounded-lg px-2 py-3 hover:bg-muted/50"
                >
                  <SubjectAvatar
                    subject={{
                      id: row?.userId ?? participant.identity.split(":")[0],
                      type: SUBJECT_TYPE.USER,
                      name,
                      avatarUrl: row?.avatarUrl ?? undefined,
                    }}
                    size="md"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">
                      {name}
                      {participant.isLocal ? " (you)" : ""}
                      {row?.userId === call?.hostUserId ? " · Host" : ""}
                    </p>
                    <p className="text-xs text-muted-foreground">{state}</p>
                  </div>
                  {canModerate && !participant.isLocal && (
                    <div className="flex gap-1">
                      <Button
                        variant="ghost"
                        className="min-h-11 min-w-11"
                        disabled={pending !== null || !participant.isMicrophoneEnabled}
                        aria-label={`Mute ${name}`}
                        onClick={() => void act(participant.identity, false)}
                      >
                        <MicrophoneSlash size={18} />
                      </Button>
                      <Button
                        variant="ghost"
                        className="min-h-11 min-w-11 text-red-500"
                        disabled={pending !== null}
                        aria-label={`Remove ${name} from call`}
                        onClick={() => setRemove({ identity: participant.identity, name })}
                      >
                        <UserMinus size={18} />
                      </Button>
                    </div>
                  )}
                </li>
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
