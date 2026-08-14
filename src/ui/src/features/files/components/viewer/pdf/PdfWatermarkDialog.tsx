import { useState } from "react";
import { Dialog, DialogBackdrop, DialogPanel, DialogTitle } from "@headlessui/react";
import { Stamp, X } from "@phosphor-icons/react";
import { useAppDispatch, useAppSelector } from "@/app/hooks";
import { setPdfWatermark } from "@/features/files/store/viewerSlice";
import { cn } from "@/shared/utils/cn";
import { Button } from "@/components/ui/button";

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

  return (
    <Dialog open={isOpen} onClose={onClose} className="relative z-50">
      <DialogBackdrop
        transition
        className="fixed inset-0 bg-black/60 backdrop-blur-sm transition-opacity data-[closed]:opacity-0"
      />

      <div className="fixed inset-0 flex items-center justify-center p-4">
        <DialogPanel
          transition
          className="w-full max-w-sm bg-card text-card-foreground rounded-xl shadow-2xl border border-border transition-all data-[closed]:scale-95 data-[closed]:opacity-0"
        >
          <div className="flex items-center justify-between px-5 py-4 border-b border-border">
            <DialogTitle className="text-lg font-semibold flex items-center gap-2">
              <Stamp size={20} />
              Watermark
            </DialogTitle>
            <button onClick={onClose} className="p-1 rounded-md hover:bg-muted transition-colors">
              <X size={20} />
            </button>
          </div>

          <div className="px-5 py-4 space-y-5">
            <div className="space-y-2">
              <label htmlFor="watermark-text" className="text-sm font-medium text-muted-foreground">
                Text
              </label>
              <input
                id="watermark-text"
                type="text"
                value={text}
                maxLength={60}
                onChange={(event) => setText(event.target.value)}
                className={cn(
                  "w-full px-3 py-2 rounded-md border border-border bg-input",
                  "text-foreground placeholder:text-muted-foreground",
                  "focus:outline-none focus:ring-2 focus:ring-ring",
                )}
                placeholder="DRAFT"
              />
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-sm font-medium text-muted-foreground">Opacity</label>
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

            <p className="text-xs text-muted-foreground">
              Applies diagonally to every page when the stamped copy is saved.
            </p>
          </div>

          <div className="flex items-center justify-between gap-2 px-5 py-4 border-t border-border">
            <Button variant="secondary" size="md" onClick={handleRemove} disabled={!watermark}>
              Remove
            </Button>
            <div className="flex items-center gap-2">
              <Button variant="secondary" size="md" onClick={onClose}>
                Cancel
              </Button>
              <Button size="md" onClick={handleApply} disabled={!text.trim()}>
                Apply
              </Button>
            </div>
          </div>
        </DialogPanel>
      </div>
    </Dialog>
  );
}
