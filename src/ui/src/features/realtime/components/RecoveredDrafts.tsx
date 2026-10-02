import { useEffect, useState } from "react";
import type * as Y from "yjs";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Modal, ModalHeader, ModalBody, ModalFooter } from "@/components/ui/modal";
import {
  readRecoveredDrafts,
  RECOVERY_AVAILABLE_EVENT,
  type RecoveredDraft,
} from "@/features/realtime/persistence/encryptedYjsPersistence";

export function RecoveredDrafts({ ydoc }: { ydoc: Y.Doc }) {
  const [drafts, setDrafts] = useState<RecoveredDraft[]>([]);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    let disposed = false;
    const refresh = () =>
      void readRecoveredDrafts(ydoc)
        .then((value) => {
          if (!disposed) setDrafts(value);
        })
        .catch(() => {});
    refresh();
    window.addEventListener(RECOVERY_AVAILABLE_EVENT, refresh);
    return () => {
      disposed = true;
      window.removeEventListener(RECOVERY_AVAILABLE_EVENT, refresh);
    };
  }, [ydoc]);
  if (!drafts.length) return null;
  return (
    <>
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
        Recovered draft
      </Button>
      {open && (
        <Modal onClose={() => setOpen(false)}>
          <ModalHeader
            title="Recovered drafts"
            description="These edits belong to an earlier version. Copy any text you want to keep into your current document."
          />
          <ModalBody>
            {drafts.map((draft, index) => (
              <div key={draft.generation} className="space-y-2 mb-4">
                <Textarea
                  aria-label={`Recovered draft ${index + 1}`}
                  value={draft.text}
                  readOnly
                  rows={8}
                />
                <Button
                  variant="ghost"
                  onClick={() => {
                    const url = URL.createObjectURL(
                      new Blob([JSON.stringify(draft, null, 2)], { type: "application/json" }),
                    );
                    const link = document.createElement("a");
                    link.href = url;
                    link.download = `recovered-draft-${index + 1}.json`;
                    link.click();
                    setTimeout(() => URL.revokeObjectURL(url), 1000);
                  }}
                >
                  Download draft
                </Button>
              </div>
            ))}
          </ModalBody>
          <ModalFooter>
            <Button onClick={() => setOpen(false)}>Close</Button>
          </ModalFooter>
        </Modal>
      )}
    </>
  );
}
