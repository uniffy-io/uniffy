import { useState } from "react";
import { Phone } from "@phosphor-icons/react";
import { useAppSelector } from "@/app/hooks";
import { Button } from "@/components/ui/button";
import { Modal, ModalBody, ModalFooter, ModalHeader } from "@/components/ui/modal";
import { CallPersonRow } from "@/features/calls/components/CallPersonRow";
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
        className="focus-ring mr-1.5 flex h-[18px] shrink-0 items-center gap-0.5 rounded px-1 text-[11px] font-medium tabular-nums text-green-600 transition-colors hover:bg-green-500/10 dark:text-green-400 pointer-coarse:min-h-11 pointer-coarse:min-w-11 pointer-coarse:justify-center"
        aria-label={`Show ${call.participants.length} call participants`}
        title="Live call"
        aria-haspopup="dialog"
        data-testid={`chat-sidebar-channel-call-${channelId}`}
      >
        <Phone size={11} weight="fill" />
        {call.participants.length}
      </button>
      {open && (
        <Modal onClose={() => setOpen(false)} maxWidth="max-w-sm">
          <ModalHeader title={`In this call (${call.participants.length})`} />
          <ModalBody>
            <ul>
              {call.participants.map((p) => (
                <CallPersonRow
                  key={p.identity}
                  userId={p.userId}
                  name={p.displayName}
                  avatarUrl={p.avatarUrl}
                  state={`${p.micEnabled ? "Microphone on" : "Muted"}${p.screenSharing ? ", sharing screen" : ""}`}
                />
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
