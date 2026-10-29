import { useEffect, useState } from "react";
import { CaretDown, Presentation } from "@phosphor-icons/react";
import { useAppDispatch } from "@/app/hooks";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useCallModeration } from "@/features/calls/hooks/useCallModeration";
import { useCallPublishing } from "@/features/calls/hooks/useCallPublishing";
import { fetchTownHallAllowed, setCallMode } from "@/features/calls/store/callsThunks";
import { canPublishInCall } from "@/features/calls/utils/callPublishing";

export function CallModeControl() {
  const dispatch = useAppDispatch();
  const { call } = useCallPublishing();
  const moderator = useCallModeration();
  const [allowedChannel, setAllowedChannel] = useState<string | null>(null);
  const [dialogDocument, setDialogDocument] = useState<Document | null>(null);
  const [pending, setPending] = useState(false);
  const channelId = call?.channelId;
  useEffect(() => {
    if (!channelId || !moderator) return;
    let cancelled = false;
    void dispatch(fetchTownHallAllowed(channelId))
      .unwrap()
      .then((allowed) => {
        if (!cancelled) setAllowedChannel(allowed ? channelId : null);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [channelId, moderator, dispatch]);
  if (!call || call.callType !== "CHANNEL") return null;
  const canChange = moderator && (call.townHall || allowedChannel === channelId);
  if (!call.townHall && !canChange) return null;
  const audience = new Set(
    call.participants.filter((p) => !canPublishInCall(call, p.userId)).map((p) => p.userId),
  ).size;
  return (
    <>
      <button
        type="button"
        disabled={!canChange}
        className="focus-ring flex min-h-11 items-center gap-1.5 rounded-md px-2 text-xs text-muted-foreground enabled:hover:bg-muted md:min-h-9"
        aria-label={call.townHall ? "Town hall mode" : "Change call mode"}
        onClick={(event) => setDialogDocument(event.currentTarget.ownerDocument)}
      >
        <Presentation size={16} />
        {call.townHall ? `Town hall · ${audience} listening` : "Regular call"}
        {canChange && <CaretDown size={10} />}
      </button>
      <ConfirmDialog
        isOpen={!!dialogDocument}
        ownerDocument={dialogDocument ?? undefined}
        onClose={() => setDialogDocument(null)}
        variant="default"
        loading={pending}
        title={call.townHall ? "Switch to regular call?" : "Switch to town hall?"}
        message={
          call.townHall
            ? "Everyone will be able to use their microphone, camera and screen sharing. Devices stay off until each person enables them."
            : "Only the host will remain a speaker. Everyone else moves to audience and their microphone, camera and screen sharing stop. You can allow speakers from raised hands or participant list."
        }
        confirmLabel={call.townHall ? "Use regular call" : "Use town hall"}
        onConfirm={async () => {
          setPending(true);
          try {
            await dispatch(setCallMode({ callId: call.id, townHall: !call.townHall })).unwrap();
            setDialogDocument(null);
          } catch {
            /* Shared thunk pipeline reports failures. */
          } finally {
            setPending(false);
          }
        }}
      />
    </>
  );
}
