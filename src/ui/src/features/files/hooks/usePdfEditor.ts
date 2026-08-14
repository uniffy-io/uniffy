import { useCallback, useState } from "react";
import { PDFDocument, degrees } from "pdf-lib";
import { useAppDispatch } from "@/app/hooks";
import { ensurePdfExtension, uploadPdfBlob } from "@/features/files/utils/uploadPdfBlob";
import { useFileDownload } from "@/features/files/components/viewer/hooks/useFileDownload";
import {
  initPageOps,
  rotatePages,
  deletePages,
  movePage,
  extractPages,
  type PageOpsState,
} from "@/features/files/components/viewer/pdf/pdfPageOps";

interface UsePdfEditorOptions {
  fileId: string;
  organizationId: string;
  filename: string;
}

interface EditorHistory {
  ops: PageOpsState | null;
  undoStack: PageOpsState[];
  redoStack: PageOpsState[];
  pageCount: number;
}

export function usePdfEditor({ fileId, organizationId, filename }: UsePdfEditorOptions) {
  const dispatch = useAppDispatch();
  const { blob: sourceBlob, loading: sourceLoading, error: sourceError } = useFileDownload(fileId);

  const [history, setHistory] = useState<EditorHistory>({
    ops: null,
    undoStack: [],
    redoStack: [],
    pageCount: 0,
  });
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const initialize = useCallback((pageCount: number) => {
    setHistory((state) =>
      state.ops ? state : { ops: initPageOps(pageCount), undoStack: [], redoStack: [], pageCount },
    );
  }, []);

  const apply = useCallback((mutate: (ops: PageOpsState) => PageOpsState) => {
    setHistory((state) => {
      if (!state.ops) return state;
      const next = mutate(state.ops);
      return {
        ...state,
        ops: next,
        undoStack: [...state.undoStack, state.ops],
        redoStack: [],
      };
    });
  }, []);

  const rotateSelection = useCallback(
    (indices: number[], direction: 1 | -1) => {
      if (indices.length === 0) return;
      apply((ops) => rotatePages(ops, indices, direction));
    },
    [apply],
  );

  const deleteSelection = useCallback(
    (indices: number[]) => {
      if (indices.length === 0) return;
      apply((ops) => deletePages(ops, indices));
    },
    [apply],
  );

  const moveCard = useCallback(
    (from: number, to: number) => {
      apply((ops) => movePage(ops, from, to));
    },
    [apply],
  );

  const undo = useCallback(() => {
    setHistory((state) => {
      const previous = state.undoStack.at(-1);
      if (!previous || !state.ops) return state;
      return {
        ...state,
        ops: previous,
        undoStack: state.undoStack.slice(0, -1),
        redoStack: [...state.redoStack, state.ops],
      };
    });
  }, []);

  const redo = useCallback(() => {
    setHistory((state) => {
      const next = state.redoStack.at(-1);
      if (!next || !state.ops) return state;
      return {
        ...state,
        ops: next,
        undoStack: [...state.undoStack, state.ops],
        redoStack: state.redoStack.slice(0, -1),
      };
    });
  }, []);

  const reset = useCallback(() => {
    setHistory((state) => {
      if (!state.ops) return state;
      return {
        ...state,
        ops: initPageOps(state.pageCount),
        undoStack: [...state.undoStack, state.ops],
        redoStack: [],
      };
    });
  }, []);

  const buildPdfBlob = useCallback(
    async (opsToBuild: PageOpsState): Promise<Blob> => {
      if (!sourceBlob) throw new Error("Source PDF not loaded");
      if (opsToBuild.length === 0) throw new Error("Cannot save an empty document");
      const source = await PDFDocument.load(await sourceBlob.arrayBuffer());
      const output = await PDFDocument.create();
      const copied = await output.copyPages(
        source,
        opsToBuild.map((op) => op.originalIndex),
      );
      copied.forEach((page, index) => {
        const extra = opsToBuild[index].rotation;
        if (extra !== 0) {
          page.setRotation(degrees((page.getRotation().angle + extra) % 360));
        }
        output.addPage(page);
      });
      const bytes = await output.save();
      return new Blob([new Uint8Array(bytes)], { type: "application/pdf" });
    },
    [sourceBlob],
  );

  const runSave = useCallback(
    async (
      build: () => Promise<Blob>,
      finalFilename: string,
      versionOfFileId?: string,
    ): Promise<boolean> => {
      setIsSaving(true);
      setSaveError(null);
      try {
        const blob = await build();
        await uploadPdfBlob(blob, finalFilename, organizationId, dispatch, {
          versionOfFileId,
        });
        setIsSaving(false);
        return true;
      } catch (error) {
        setIsSaving(false);
        setSaveError(error instanceof Error ? error.message : "Failed to save PDF");
        return false;
      }
    },
    [organizationId, dispatch],
  );

  const saveAsNewFile = useCallback(
    (newFilename: string): Promise<boolean> => {
      const ops = history.ops;
      if (!ops) return Promise.resolve(false);
      return runSave(() => buildPdfBlob(ops), ensurePdfExtension(newFilename));
    },
    [history.ops, runSave, buildPdfBlob],
  );

  const saveAsNewVersion = useCallback((): Promise<boolean> => {
    const ops = history.ops;
    if (!ops) return Promise.resolve(false);
    return runSave(() => buildPdfBlob(ops), filename, fileId);
  }, [history.ops, runSave, buildPdfBlob, filename, fileId]);

  const saveExtractedPages = useCallback(
    (indices: number[], newFilename: string): Promise<boolean> => {
      const ops = history.ops;
      if (!ops || indices.length === 0) return Promise.resolve(false);
      return runSave(
        () => buildPdfBlob(extractPages(ops, indices)),
        ensurePdfExtension(newFilename),
      );
    },
    [history.ops, runSave, buildPdfBlob],
  );

  return {
    sourceBlob,
    sourceLoading,
    sourceError,
    ops: history.ops,
    canUndo: history.undoStack.length > 0,
    canRedo: history.redoStack.length > 0,
    hasChanges: history.undoStack.length > 0,
    isSaving,
    saveError,
    clearSaveError: () => setSaveError(null),
    initialize,
    rotateSelection,
    deleteSelection,
    moveCard,
    undo,
    redo,
    reset,
    saveAsNewFile,
    saveAsNewVersion,
    saveExtractedPages,
  };
}
