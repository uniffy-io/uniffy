/**
 * NoteNode - Canvas node that displays a referenced note as a mini-view.
 *
 * Fetches the referenced note by ID and renders a truncated
 * CrepeEditor in compact + readonly mode. Double-click navigates to the note.
 */

import { memo, useCallback, useEffect, useState } from "react";
import { type NodeProps, NodeResizer, Handle, Position } from "@xyflow/react";
import { useNavigate } from "react-router-dom";
import { CrepeEditor } from "@/components/editor/CrepeEditor";
import { ContentType } from "@uniffy/proto/common/v1/common_pb";
import { useAppDispatch, useAppSelector } from "@/app/hooks";
import { fetchNote } from "@/features/notes/store/notesSlice";
import { cn } from "@/shared/utils/cn";
import type { NoteCanvasNode } from "@/features/notes/canvas/types";
import { useCanvasCallbacks } from "@/features/notes/canvas/hooks/useCanvasCallbacks";
import { NodeStyleToolbar } from "@/features/notes/canvas/components/NodeStyleToolbar";

export const NoteNode = memo(function NoteNode({ id, data, selected }: NodeProps<NoteCanvasNode>) {
  const navigate = useNavigate();
  const dispatch = useAppDispatch();
  const { onNodeStyleChange, readonly } = useCanvasCallbacks();
  const note = useAppSelector((state) => (data.noteId ? state.notes.notes[data.noteId] : null));
  const loadingNoteId = useAppSelector((state) => state.notes.loadingNoteId);
  const [fetchState, setFetchState] = useState<"idle" | "loading" | "failed">("idle");

  const bgColor = data.bgColor || "";
  const borderColor = data.borderColor || "";
  const borderWidth = data.borderWidth;

  // Fetch if note is missing or was loaded without content (e.g. from list fetch)
  const needsFetch = !note || (!note.content && fetchState === "idle");

  useEffect(() => {
    if (!needsFetch || !data.noteId || fetchState === "loading" || fetchState === "failed") return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- tracking fetch lifecycle
    setFetchState("loading");
    dispatch(fetchNote(data.noteId))
      .unwrap()
      .then(() => setFetchState("idle"))
      .catch(() => setFetchState("failed"));
  }, [needsFetch, data.noteId, fetchState, dispatch]);

  const handleClick = useCallback(() => {
    if (data.noteId) {
      navigate(`/notes/${data.noteId}`);
    }
  }, [data.noteId, navigate]);

  const handleStyleChange = useCallback(
    (updates: Record<string, unknown>) => {
      onNodeStyleChange(id, updates);
    },
    [id, onNodeStyleChange],
  );

  const title = note?.title || data.title || "Note";
  const content = note?.content || "";
  const isLoading = fetchState === "loading" || loadingNoteId === data.noteId;

  const inlineStyle: React.CSSProperties = {
    width: "100%",
    height: "100%",
    ...(bgColor && bgColor !== "transparent" ? { backgroundColor: bgColor } : {}),
    ...(bgColor === "transparent" ? { backgroundColor: "transparent" } : {}),
    ...(borderColor && borderColor !== "transparent"
      ? { borderColor }
      : borderColor === "transparent"
        ? { borderColor: "transparent" }
        : {}),
    ...(borderWidth !== undefined ? { borderWidth: `${borderWidth}px` } : {}),
  };

  return (
    <>
      <NodeResizer
        isVisible={selected}
        minWidth={200}
        minHeight={100}
        lineClassName="!border-primary"
        handleClassName="!w-2 !h-2 !bg-primary !border-primary"
      />
      <Handle type="target" position={Position.Top} className="!bg-primary !w-2 !h-2" />
      <Handle type="source" position={Position.Bottom} className="!bg-primary !w-2 !h-2" />
      <Handle type="target" position={Position.Left} className="!bg-primary !w-2 !h-2" />
      <Handle type="source" position={Position.Right} className="!bg-primary !w-2 !h-2" />
      <div
        className={cn(
          "rounded-lg border bg-card text-card-foreground shadow-sm overflow-hidden cursor-pointer",
          selected ? "border-primary ring-1 ring-primary/30" : "border-border",
          "hover:border-primary/50 transition-colors",
        )}
        style={inlineStyle}
        onDoubleClick={handleClick}
      >
        {/* Card header with note title */}
        <div className="px-3 py-2 border-b border-border bg-muted/30">
          <h4 className="text-sm font-medium truncate">{title}</h4>
        </div>

        {/* Note content preview */}
        <div className="h-[calc(100%-36px)] overflow-auto p-1 nowheel">
          {content ? (
            <CrepeEditor
              contentType={ContentType.NOTE}
              contentId={data.noteId || id}
              value={content}
              readonly={true}
              compact={true}
              enableComments={false}
            />
          ) : (
            <div className="flex items-center justify-center h-full text-muted-foreground text-xs">
              {isLoading
                ? "Loading..."
                : fetchState === "failed"
                  ? "Failed to load note"
                  : "Empty note"}
            </div>
          )}
        </div>
      </div>

      {selected && !readonly && (
        <NodeStyleToolbar
          fillColor={bgColor || "transparent"}
          borderColor={borderColor || "transparent"}
          borderWidth={borderWidth ?? 1}
          onStyleChange={handleStyleChange}
          fillFieldName="bgColor"
          fillLabel="Background"
        />
      )}
    </>
  );
});
