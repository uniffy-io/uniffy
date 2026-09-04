import { useAppDispatch, useAppSelector } from "@/app/hooks";
import { Button } from "@/components/ui/button";
import { Modal, ModalBody, ModalFooter, ModalHeader } from "@/components/ui/modal";
import {
  firstUseAcknowledged,
  firstUseModalClosed,
} from "@/features/recording/store/recordingSlice";
import { startRecording } from "@/features/recording/store/recordingThunks";

export function RecordingFirstUseModal() {
  const dispatch = useAppDispatch();
  const open = useAppSelector((state) => state.recording.firstUseModalOpen);

  if (!open) return null;

  const handleClose = () => {
    dispatch(firstUseModalClosed());
  };

  const handleContinue = () => {
    dispatch(firstUseAcknowledged());
    void dispatch(startRecording());
  };

  return (
    <Modal onClose={handleClose} maxWidth="max-w-md">
      <ModalHeader title="Before you record" />

      <ModalBody className="space-y-3 text-sm leading-relaxed text-foreground">
        <p>
          Your recording will capture everything visible on the screen, window, or tab you choose.
          That includes:
        </p>
        <ul className="list-disc pl-5 space-y-1 text-muted-foreground">
          <li>Notifications, banners, and chat windows that appear during the clip.</li>
          <li>Passwords or secrets briefly shown on screen.</li>
          <li>Other people&apos;s names, photos, and email addresses.</li>
        </ul>
        <p className="text-muted-foreground">
          Pause or stop any time. The clip lands in your private
          <span className="font-medium text-foreground"> Recordings </span>
          folder; you can share or delete it later.
        </p>
      </ModalBody>

      <ModalFooter>
        <p className="mr-auto text-[11px] text-muted-foreground/70">
          This message only shows once.
        </p>
        <Button variant="ghost" onClick={handleClose}>
          Cancel
        </Button>
        <Button onClick={handleContinue}>Continue</Button>
      </ModalFooter>
    </Modal>
  );
}
