import { useState } from "react";
import { Phone } from "@phosphor-icons/react";
import { useAppSelector } from "@/app/hooks";
import { SubjectAvatar } from "@/components/subject/SubjectAvatar";
import { SUBJECT_TYPE } from "@/components/subject/types";
import { Button } from "@/components/ui/button";
import { Modal, ModalBody, ModalFooter, ModalHeader } from "@/components/ui/modal";
import { selectActiveCallForChannel } from "@/features/calls/store/callsSlice";

export function ChannelCallIndicator({ channelId }: { channelId: string }) {
  const call = useAppSelector((s) => selectActiveCallForChannel(s, channelId));
  const [open, setOpen] = useState(false);
  if (!call || call.participants.length === 0) return null;
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="focus-ring flex min-h-11 min-w-11 shrink-0 items-center justify-center gap-1 rounded-md text-primary"
        aria-label={`Show ${call.participants.length} call participants`}
        aria-haspopup="dialog"
        data-testid={`chat-sidebar-channel-call-${channelId}`}
      >
        <Phone size={12} weight="fill" />
        <span className="text-xs tabular-nums">{call.participants.length}</span>
      </button>
      {open && (
        <Modal onClose={() => setOpen(false)} maxWidth="max-w-sm">
          <ModalHeader title={`In this call (${call.participants.length})`} />
          <ModalBody>
            <ul className="space-y-3">
              {call.participants.map((p) => (
                <li key={p.identity} className="flex items-center gap-3">
                  <SubjectAvatar
                    subject={{
                      id: p.userId,
                      type: SUBJECT_TYPE.USER,
                      name: p.displayName,
                      avatarUrl: p.avatarUrl ?? undefined,
                    }}
                    size="md"
                  />
                  <div className="min-w-0">
                    <p className="truncate text-sm">{p.displayName}</p>
                    <p className="text-xs text-muted-foreground">
                      {p.micEnabled ? "Microphone on" : "Muted"}
                      {p.screenSharing ? ", sharing screen" : ""}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          </ModalBody>
          <ModalFooter>
            <Button autoFocus variant="ghost" onClick={() => setOpen(false)}>
              Close
            </Button>
          </ModalFooter>
        </Modal>
      )}
    </>
  );
}
