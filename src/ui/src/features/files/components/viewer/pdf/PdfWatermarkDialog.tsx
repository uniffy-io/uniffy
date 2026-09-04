import { useState } from "react";
import { useAppDispatch, useAppSelector } from "@/app/hooks";
import { setPdfWatermark } from "@/features/files/store/viewerSlice";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal, ModalBody, ModalFooter, ModalHeader } from "@/components/ui/modal";

interface PdfWatermarkDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

export function PdfWatermarkDialog({ isOpen, onClose }: PdfWatermarkDialogProps) {
  const dispatch = useAppDispatch();
  const watermark = useAppSelector((state) => state.fileViewer.pdfWatermark);

  const [text, setText] = useState(watermark?.text ?? "DRAFT");
  const [opacityPercent, setOpacityPercent] = useState(
    Math.round((watermark?.opacity ?? 0.2) * 100),
  );

  const handleApply = () => {
    if (text.trim()) {
      dispatch(setPdfWatermark({ text: text.trim(), opacity: opacityPercent / 100 }));
    }
    onClose();
  };

  const handleRemove = () => {
    dispatch(setPdfWatermark(null));
    onClose();
  };

  if (!isOpen) return null;

  return (
    <Modal onClose={onClose} maxWidth="max-w-sm">
      <ModalHeader
        title="Watermark"
        description="Stamped diagonally across every page when the copy is saved."
      />

      <ModalBody>
        <div>
          <label htmlFor="watermark-text" className="block text-sm text-muted-foreground mb-1">
            Text
          </label>
          <Input
            id="watermark-text"
            type="text"
            value={text}
            maxLength={60}
            onChange={(event) => setText(event.target.value)}
            placeholder="DRAFT"
          />
        </div>

        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="text-sm text-muted-foreground">Opacity</label>
            <span className="text-sm text-muted-foreground">{opacityPercent}%</span>
          </div>
          <input
            type="range"
            min={5}
            max={60}
            value={opacityPercent}
            onChange={(event) => setOpacityPercent(Number(event.target.value))}
            className="w-full h-2 rounded-full appearance-none cursor-pointer bg-muted accent-primary"
          />
        </div>
      </ModalBody>

      <ModalFooter>
        <Button variant="ghost" className="mr-auto" onClick={handleRemove} disabled={!watermark}>
          Remove
        </Button>
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button onClick={handleApply} disabled={!text.trim()}>
          Apply
        </Button>
      </ModalFooter>
    </Modal>
  );
}
