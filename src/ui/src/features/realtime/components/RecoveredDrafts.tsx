import { useCallback, useContext, useEffect, useState } from "react";
import type * as Y from "yjs";
import { ClockCounterClockwise } from "@phosphor-icons/react";
import { ContentType } from "@uniffy/proto/common/v1/common_pb";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Modal, ModalHeader, ModalBody, ModalFooter } from "@/components/ui/modal";
import { CrepeEditor } from "@/components/editor/CrepeEditor";
import {
  MarkdownRecoveryContext,
  useEditorHandle,
  type EditorHandle,
  type MarkdownRecoveryActions,
} from "@/components/editor/EditorHandle";
import { DOC_META_FIELD } from "@/features/realtime/docGeneration";
import { useInitialSync } from "@/features/realtime/hooks/useInitialSync";
import { applyRecoveredMarkdown, recoveredMarkdown } from "@/features/realtime/recoveredMarkdown";
import {
  discardRecoveredDraft,
  readRecoveredDrafts,
  RECOVERY_AVAILABLE_EVENT,
  type RecoveredDraft,
} from "@/features/realtime/persistence/encryptedYjsPersistence";

function download(text: string, name: string, type: string): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function DraftItem({
  draft,
  index,
  actions,
  onApply,
  onDiscard,
}: {
  draft: RecoveredDraft;
  index: number;
  actions: MarkdownRecoveryActions | null;
  onApply: () => void;
  onDiscard: () => Promise<void>;
}) {
  const [text, setText] = useState<string | null>(draft.hasFragment ? null : draft.text);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const prepare = useCallback(
    (handle: EditorHandle | null) => {
      if (!handle) return;
      const value = handle.run((ctx) => recoveredMarkdown(draft.update, ctx));
      if (value === undefined)
        setError("Could not read rich draft. Original recovery data is retained.");
      else setText(value);
    },
    [draft.update],
  );
  const restore = (replace: boolean) => {
    if (!actions || text === null) return;
    try {
      if (replace) actions.replace(text);
      else actions.insert(text);
      onApply();
    } catch {
      setError("Could not restore draft. Keep this copy and try again.");
    }
  };
  return (
    <div className="space-y-2 mb-4">
      {draft.hasFragment && (
        <div hidden aria-hidden="true">
          <CrepeEditor
            contentType={ContentType.UNSPECIFIED}
            contentId=""
            value=""
            readonly
            enableUpload={false}
            onEditorReady={prepare}
          />
        </div>
      )}
      <Textarea
        aria-label={`Recovered draft ${index + 1}`}
        value={text ?? "Reading draft..."}
        readOnly
        rows={8}
      />
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        {actions && (
          <>
            <Button variant="ghost" disabled={text === null || busy} onClick={() => restore(false)}>
              Insert at cursor
            </Button>
            <Button variant="ghost" disabled={text === null || busy} onClick={() => restore(true)}>
              Replace document
            </Button>
          </>
        )}
        <Button
          variant="ghost"
          disabled={text === null}
          onClick={() =>
            download(text!, `recovered-draft-${index + 1}.md`, "text/markdown;charset=utf-8")
          }
        >
          Download Markdown
        </Button>
        {error && text === null && (
          <Button
            variant="ghost"
            onClick={() =>
              download(
                JSON.stringify(draft),
                `recovered-draft-${index + 1}.json`,
                "application/json",
              )
            }
          >
            Download recovery data
          </Button>
        )}
        <Button
          variant="ghost"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            void onDiscard()
              .catch(() => setError("Could not discard draft. Try again."))
              .finally(() => setBusy(false));
          }}
        >
          Discard
        </Button>
      </div>
    </div>
  );
}

/** Opens the drafts dialog. On phone widths only its icon shows, so the bar it sits in keeps its
 * row; the label stays for screen readers and the title. */
export function RecoveredDraftsTrigger({ onOpen }: { onOpen: () => void }) {
  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={onOpen}
      title="Recovered draft"
      className="shrink-0 whitespace-nowrap"
    >
      <ClockCounterClockwise size={14} weight="bold" className="shrink-0" />
      <span className="max-sm:sr-only">Recovered draft</span>
    </Button>
  );
}

export function RecoveredDrafts({ ydoc, whenSynced }: { ydoc: Y.Doc; whenSynced?: Promise<void> }) {
  const [drafts, setDrafts] = useState<RecoveredDraft[]>([]);
  const [open, setOpen] = useState(false);
  const [reloads, setReloads] = useState(0);
  const synced = useInitialSync(whenSynced);
  const handle = useEditorHandle();
  const markdownActions = useContext(MarkdownRecoveryContext);
  const actions =
    markdownActions ??
    (handle?.view.editable
      ? {
          insert: (text: string) => {
            if (
              !handle.run((ctx) => {
                applyRecoveredMarkdown(ctx, text, false);
                return true;
              })
            )
              throw new Error("Editor unavailable");
            handle.flushMarkdownMirror?.();
          },
          replace: (text: string) => {
            if (
              !handle.run((ctx) => {
                applyRecoveredMarkdown(ctx, text, true);
                return true;
              })
            )
              throw new Error("Editor unavailable");
            handle.flushMarkdownMirror?.();
          },
        }
      : null);
  useEffect(() => {
    if (!synced) return;
    let disposed = false;
    let request = 0;
    const refresh = () => {
      const current = ++request;
      void readRecoveredDrafts(ydoc)
        .then((value) => {
          if (!disposed && current === request) setDrafts(value);
        })
        .catch(() => {});
    };
    refresh();
    const meta = ydoc.getMap(DOC_META_FIELD);
    meta.observe(refresh);
    window.addEventListener(RECOVERY_AVAILABLE_EVENT, refresh);
    return () => {
      disposed = true;
      meta.unobserve(refresh);
      window.removeEventListener(RECOVERY_AVAILABLE_EVENT, refresh);
    };
  }, [ydoc, reloads, synced]);
  if (!synced || !drafts.length) return null;
  return (
    <>
      <RecoveredDraftsTrigger onOpen={() => setOpen(true)} />
      {open && (
        <Modal onClose={() => setOpen(false)}>
          <ModalHeader
            title="Recovered drafts"
            description="Review text saved on this device. Restore or download what you need. Copies stay here until you discard them."
          />
          <ModalBody>
            {drafts.map((draft, index) => (
              <DraftItem
                key={`${draft.generation}:${draft.update}`}
                draft={draft}
                index={index}
                actions={actions}
                onApply={() => setOpen(false)}
                onDiscard={async () => {
                  await discardRecoveredDraft(ydoc, draft.generation);
                  setReloads((value) => value + 1);
                }}
              />
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
