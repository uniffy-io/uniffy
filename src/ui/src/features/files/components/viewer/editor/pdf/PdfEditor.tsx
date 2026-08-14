import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Document, Thumbnail, pdfjs } from "react-pdf";
import type { PDFDocumentProxy } from "pdfjs-dist";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import {
  ArrowClockwise,
  ArrowCounterClockwise,
  ArrowUUpLeft,
  ArrowUUpRight,
  ClockCounterClockwise,
  Export,
  FloppyDisk,
  Spinner,
  Trash,
  X,
} from "@phosphor-icons/react";
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { SortableContext, rectSortingStrategy, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useAppSelector } from "@/app/hooks";
import { useShortcutHandlers } from "@/features/settings";
import { usePdfEditor } from "@/features/files/hooks/usePdfEditor";
import { PdfSaveDialog } from "@/features/files/components/viewer/editor/pdf/PdfSaveDialog";
import type { PageOp } from "@/features/files/components/viewer/pdf/pdfPageOps";
import type { SerializedFile } from "@/features/files/store/filesThunks";
import { cn } from "@/shared/utils/cn";

pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

const PDF_OPTIONS = { verbosity: pdfjs.VerbosityLevel.ERRORS } as const;
const THUMB_WIDTH = 140;

interface PdfEditorProps {
  file: SerializedFile;
  onClose: () => void;
}

export function PdfEditor({ file, onClose }: PdfEditorProps) {
  const organizationId = useAppSelector((state) => state.auth.currentOrganizationId);
  const editor = usePdfEditor({
    fileId: file.id,
    organizationId: organizationId || "",
    filename: file.filename,
  });

  /** Selection keyed by originalIndex (stable across reorder and undo). */
  const [selected, setSelected] = useState<Set<number>>(() => new Set());
  const [lastClickedIndex, setLastClickedIndex] = useState<number | null>(null);
  const [dialogIntent, setDialogIntent] = useState<"edit" | "extract" | null>(null);
  const [thumbAspect, setThumbAspect] = useState(1.4);
  const [visibleCards, setVisibleCards] = useState<Set<number>>(() => new Set());

  const gridRef = useRef<HTMLDivElement | null>(null);
  const cardElsRef = useRef(new Map<number, HTMLDivElement>());

  const ops = editor.ops;
  const selectedIndices = useMemo(
    () => (ops ? ops.flatMap((op, index) => (selected.has(op.originalIndex) ? [index] : [])) : []),
    [ops, selected],
  );

  const sensors = useSensors(
    // A small activation distance keeps plain clicks as selection, drags as reorder.
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  );

  const handleLoadSuccess = useCallback(
    (pdf: PDFDocumentProxy) => {
      editor.initialize(pdf.numPages);
      void pdf.getPage(1).then((page) => {
        const viewport = page.getViewport({ scale: 1 });
        setThumbAspect(viewport.height / viewport.width);
      });
    },
    [editor],
  );

  // Stale ids from deleted pages stay in `selected` harmlessly: selectedIndices
  // intersects with live ops, and an undo restores the page still selected.

  // Thumbnails are canvas renders; only mount the ones near the grid viewport.
  useEffect(() => {
    const root = gridRef.current;
    if (!root || !ops) return;
    const observer = new IntersectionObserver(
      (entries) => {
        setVisibleCards((prev) => {
          let changed = false;
          const next = new Set(prev);
          for (const entry of entries) {
            const id = Number((entry.target as HTMLElement).dataset.card);
            if (entry.isIntersecting && !next.has(id)) {
              next.add(id);
              changed = true;
            } else if (!entry.isIntersecting && next.has(id)) {
              next.delete(id);
              changed = true;
            }
          }
          return changed ? next : prev;
        });
      },
      { root, rootMargin: "400px 0px" },
    );
    for (const el of cardElsRef.current.values()) {
      observer.observe(el);
    }
    return () => observer.disconnect();
  }, [ops]);

  const registerCardEl = useCallback((id: number, el: HTMLDivElement | null) => {
    if (el) {
      cardElsRef.current.set(id, el);
    } else {
      cardElsRef.current.delete(id);
    }
  }, []);

  const handleCardClick = useCallback(
    (index: number, event: React.MouseEvent) => {
      if (!ops) return;
      const id = ops[index].originalIndex;
      setSelected((prev) => {
        const next = new Set(prev);
        if (event.shiftKey && lastClickedIndex !== null) {
          const [from, to] =
            lastClickedIndex < index ? [lastClickedIndex, index] : [index, lastClickedIndex];
          for (let i = from; i <= to; i += 1) {
            next.add(ops[i].originalIndex);
          }
          return next;
        }
        if (event.ctrlKey || event.metaKey) {
          if (next.has(id)) {
            next.delete(id);
          } else {
            next.add(id);
          }
          return next;
        }
        return new Set([id]);
      });
      setLastClickedIndex(index);
    },
    [ops, lastClickedIndex],
  );

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      if (!ops || !event.over || event.active.id === event.over.id) return;
      const from = ops.findIndex((op) => op.originalIndex === event.active.id);
      const to = ops.findIndex((op) => op.originalIndex === event.over!.id);
      if (from !== -1 && to !== -1) {
        editor.moveCard(from, to);
      }
    },
    [ops, editor],
  );

  const handleDelete = useCallback(() => {
    if (!ops || selectedIndices.length === 0 || selectedIndices.length === ops.length) return;
    editor.deleteSelection(selectedIndices);
    setSelected(new Set());
  }, [ops, selectedIndices, editor]);

  const closeDialog = useCallback(() => {
    setDialogIntent(null);
    editor.clearSaveError();
  }, [editor]);

  const handleSaveAsNew = useCallback(
    async (filename: string) => {
      const success =
        dialogIntent === "extract"
          ? await editor.saveExtractedPages(selectedIndices, filename)
          : await editor.saveAsNewFile(filename);
      if (success) {
        setDialogIntent(null);
        onClose();
      }
      return success;
    },
    [dialogIntent, editor, selectedIndices, onClose],
  );

  const handleSaveAsVersion = useCallback(async () => {
    const success = await editor.saveAsNewVersion();
    if (success) {
      setDialogIntent(null);
      onClose();
    }
    return success;
  }, [editor, onClose]);

  useShortcutHandlers(
    {
      "imageEditor.undo": editor.undo,
      "imageEditor.redo": editor.redo,
      "imageEditor.save": () => {
        if (editor.hasChanges && !editor.isSaving) {
          setDialogIntent("edit");
        }
      },
      "imageEditor.cancel": () => {
        if (dialogIntent) {
          closeDialog();
        } else {
          onClose();
        }
      },
    },
    { enabled: !editor.isSaving },
  );

  // Delete/Backspace remove the selection; skipped while typing in the save dialog.
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Delete" && event.key !== "Backspace") return;
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.isContentEditable)) return;
      event.preventDefault();
      handleDelete();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleDelete]);

  if (editor.sourceLoading || (!editor.sourceBlob && !editor.sourceError)) {
    return (
      <div className="w-full h-full flex items-center justify-center">
        <div className="animate-pulse w-12 h-12 rounded-full bg-white/10" />
      </div>
    );
  }

  if (editor.sourceError || !editor.sourceBlob) {
    return (
      <div className="viewer-error">
        <p>{editor.sourceError || "Unable to load PDF"}</p>
      </div>
    );
  }

  const hasSelection = selectedIndices.length > 0;
  const deleteDisabled =
    !hasSelection || !ops || selectedIndices.length === ops.length || editor.isSaving;

  return (
    <div className="w-full h-full flex flex-col bg-black/20">
      <div className="viewer-toolbar flex items-center justify-between px-4 py-2.5 z-10">
        <div className="flex items-center gap-3 min-w-0">
          <button onClick={onClose} className="viewer-btn p-2" title="Cancel (Esc)">
            <X size={20} weight="bold" />
          </button>
          <div className="viewer-file-info">
            <h2 className="viewer-file-name">{file.filename}</h2>
            <p className="viewer-file-size">
              {hasSelection ? `${selectedIndices.length} selected` : `${ops?.length ?? 0} pages`}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1">
          <button
            onClick={() => editor.rotateSelection(selectedIndices, -1)}
            disabled={!hasSelection || editor.isSaving}
            className="viewer-btn p-2"
            title="Rotate left"
          >
            <ArrowCounterClockwise size={18} />
          </button>
          <button
            onClick={() => editor.rotateSelection(selectedIndices, 1)}
            disabled={!hasSelection || editor.isSaving}
            className="viewer-btn p-2"
            title="Rotate right"
          >
            <ArrowClockwise size={18} />
          </button>
          <button
            onClick={handleDelete}
            disabled={deleteDisabled}
            className="viewer-btn p-2"
            title="Delete pages (Del)"
          >
            <Trash size={18} />
          </button>
          <button
            onClick={() => setDialogIntent("extract")}
            disabled={!hasSelection || editor.isSaving}
            className="viewer-btn p-2"
            title="Extract selection as new file"
          >
            <Export size={18} />
          </button>

          <div className="viewer-divider mx-1" />

          <button
            onClick={editor.undo}
            disabled={!editor.canUndo || editor.isSaving}
            className="viewer-btn p-2"
            title="Undo (Ctrl+Z)"
          >
            <ArrowUUpLeft size={18} />
          </button>
          <button
            onClick={editor.redo}
            disabled={!editor.canRedo || editor.isSaving}
            className="viewer-btn p-2"
            title="Redo (Ctrl+Shift+Z)"
          >
            <ArrowUUpRight size={18} />
          </button>
          <button
            onClick={editor.reset}
            disabled={!editor.hasChanges || editor.isSaving}
            className="viewer-btn p-2"
            title="Reset all changes"
          >
            <ClockCounterClockwise size={18} />
          </button>
        </div>

        <div className="flex items-center gap-1">
          <button
            onClick={() => setDialogIntent("edit")}
            disabled={!editor.hasChanges || editor.isSaving}
            className="viewer-btn-primary px-4 py-2 text-sm inline-flex items-center gap-2"
            title="Save (Ctrl+S)"
          >
            {editor.isSaving ? (
              <Spinner size={16} className="animate-spin" />
            ) : (
              <FloppyDisk size={16} />
            )}
            Save
          </button>
        </div>
      </div>

      <Document
        file={editor.sourceBlob}
        options={PDF_OPTIONS}
        onLoadSuccess={handleLoadSuccess}
        className="viewer-pdf-editor-body"
        loading={
          <div className="viewer-loading">
            <Spinner size={32} className="animate-spin" />
          </div>
        }
        error={
          <div className="viewer-error">
            <p>Failed to load PDF</p>
          </div>
        }
      >
        {ops && (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <SortableContext
              items={ops.map((op) => op.originalIndex)}
              strategy={rectSortingStrategy}
            >
              <div ref={gridRef} className="viewer-pdf-editor-grid">
                {ops.map((op, index) => (
                  <PdfEditorCard
                    key={op.originalIndex}
                    op={op}
                    index={index}
                    selected={selected.has(op.originalIndex)}
                    visible={visibleCards.has(op.originalIndex)}
                    thumbAspect={thumbAspect}
                    registerEl={registerCardEl}
                    onCardClick={handleCardClick}
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>
        )}
      </Document>

      <PdfSaveDialog
        isOpen={dialogIntent !== null}
        intent={dialogIntent ?? "edit"}
        originalFilename={file.filename}
        isSaving={editor.isSaving}
        error={editor.saveError}
        onClose={closeDialog}
        onSaveAsNew={handleSaveAsNew}
        onSaveAsVersion={handleSaveAsVersion}
      />
    </div>
  );
}

interface PdfEditorCardProps {
  op: PageOp;
  index: number;
  selected: boolean;
  visible: boolean;
  thumbAspect: number;
  registerEl: (id: number, el: HTMLDivElement | null) => void;
  onCardClick: (index: number, event: React.MouseEvent) => void;
}

function PdfEditorCard({
  op,
  index,
  selected,
  visible,
  thumbAspect,
  registerEl,
  onCardClick,
}: PdfEditorCardProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: op.originalIndex,
  });

  const rotatedAspect = op.rotation % 180 === 0 ? thumbAspect : 1 / thumbAspect;
  const thumbHeight = Math.round(THUMB_WIDTH * rotatedAspect);
  // Swapped dims mean the CSS-rotated canvas needs shrinking to stay inside the card.
  const rotatedScale = op.rotation % 180 === 0 ? 1 : Math.min(1, 1 / thumbAspect);

  return (
    <div
      ref={(el) => {
        setNodeRef(el);
        registerEl(op.originalIndex, el);
      }}
      data-card={op.originalIndex}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        "viewer-pdf-editor-card",
        selected && "viewer-pdf-editor-card-selected",
        isDragging && "opacity-60 z-10",
      )}
      onClick={(event) => onCardClick(index, event)}
      {...attributes}
      {...listeners}
    >
      <div className="viewer-pdf-editor-thumb" style={{ height: thumbHeight, width: THUMB_WIDTH }}>
        {visible ? (
          <div
            style={{
              transform: `rotate(${op.rotation}deg) scale(${rotatedScale})`,
            }}
          >
            <Thumbnail
              pageNumber={op.originalIndex + 1}
              width={THUMB_WIDTH}
              loading={
                <div
                  className="viewer-pdf-thumb-placeholder"
                  style={{ height: thumbHeight, width: THUMB_WIDTH }}
                />
              }
            />
          </div>
        ) : (
          <div
            className="viewer-pdf-thumb-placeholder"
            style={{ height: thumbHeight, width: THUMB_WIDTH }}
          />
        )}
        {/* Swallow the Thumbnail link's own click handling; the card owns selection. */}
        <div className="absolute inset-0" />
      </div>
      <span className="viewer-pdf-editor-badge">{index + 1}</span>
    </div>
  );
}
