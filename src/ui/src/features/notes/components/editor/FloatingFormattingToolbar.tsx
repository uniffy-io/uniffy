import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import {
  TextB,
  TextItalic,
  TextUnderline,
  TextStrikethrough,
  Code,
  Link,
  Highlighter,
  ChatCircle,
  At,
} from "@phosphor-icons/react";
import { editorViewCtx } from "@milkdown/core";
import type { EditorView } from "@milkdown/prose/view";
import { popoverShellClass } from "@/components/ui/popover";
import { useEditorHandle, type EditorHandle } from "@/components/editor/EditorHandle";
import { cn } from "@/shared/utils/cn";
import { subscribeSelection } from "@/components/editor/utils/selectionVersionPlugin";
import { useActiveMarks } from "@/features/notes/components/editor/toolbar/useActiveMarks";
import { toolbarCommands } from "@/features/notes/components/editor/toolbar/toolbarCommands";
import {
  ToolbarButton,
  ToolbarGroup,
  ToolbarSeparator,
} from "@/features/notes/components/editor/toolbar/ToolbarButton";
import { HeadingDropdown } from "@/features/notes/components/editor/toolbar/HeadingDropdown";
import { HighlightPicker } from "@/components/editor/plugins/highlight/HighlightPicker";
import { highlightMark } from "@/components/editor/plugins/highlight";
import { LinkPrompt } from "@/features/notes/components/editor/toolbar/LinkPrompt";

interface SelectionAnchor {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

const VERTICAL_OFFSET = 8;
const ESTIMATED_TOOLBAR_HEIGHT = 40;

function readSelectionAnchor(handle: EditorHandle | null): SelectionAnchor | null {
  if (!handle) return null;
  const { view } = handle;
  if (!view || view.isDestroyed) return null;
  const { state } = view;
  const { from, to, empty } = state.selection;
  if (empty) return null;
  // Only show on regular text selections; node selections (image, video, etc.) skip the bar.
  if ("node" in state.selection) return null;
  try {
    const start = view.coordsAtPos(from);
    const end = view.coordsAtPos(to);
    return {
      top: Math.min(start.top, end.top),
      bottom: Math.max(start.bottom, end.bottom),
      left: Math.min(start.left, end.left),
      right: Math.max(start.right, end.right),
    };
  } catch {
    return null;
  }
}

function anchorsEqual(a: SelectionAnchor | null, b: SelectionAnchor | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.top === b.top && a.bottom === b.bottom && a.left === b.left && a.right === b.right;
}

interface AnchorStore {
  subscribe: (cb: () => void) => () => void;
  getSnapshot: () => SelectionAnchor | null;
}

function createAnchorStore(handle: EditorHandle | null): AnchorStore {
  if (!handle) {
    return {
      subscribe: () => () => {},
      getSnapshot: () => null,
    };
  }

  let cached: SelectionAnchor | null = null;
  let needsRecompute = true;

  return {
    subscribe: (cb) =>
      subscribeSelection(handle.scope, () => {
        needsRecompute = true;
        cb();
      }),
    getSnapshot: () => {
      if (!needsRecompute) return cached;
      const next = readSelectionAnchor(handle);
      needsRecompute = false;
      if (!anchorsEqual(cached, next)) cached = next;
      return cached;
    },
  };
}

export function FloatingFormattingToolbar() {
  const handle = useEditorHandle();
  const active = useActiveMarks();
  const [highlightAnchor, setHighlightAnchor] = useState<DOMRect | null>(null);
  const [linkAnchor, setLinkAnchor] = useState<DOMRect | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [position, setPosition] = useState<{
    top: number;
    left: number;
    placement: "top" | "bottom";
  } | null>(null);

  // Track the current selection rect. Cached by value so getSnapshot returns
  // a stable reference between renders unless the selection actually moved
  // (required by useSyncExternalStore to avoid infinite re-renders).
  const store = useMemo(() => createAnchorStore(handle), [handle]);
  const anchor = useSyncExternalStore(store.subscribe, store.getSnapshot, () => null);

  // Hide the bar while a comment popover is open for this selection. We snap
  // the anchor at the moment Comment is clicked; as long as the selection
  // stays identical (which it will while the popover is open), the bar stays
  // hidden. A new selection clears the snapshot through value comparison.
  const [commentSnapshot, setCommentSnapshot] = useState<SelectionAnchor | null>(null);
  const hiddenForComment = commentSnapshot !== null && anchorsEqual(commentSnapshot, anchor);

  const visible = anchor !== null && !hiddenForComment;

  // Position the toolbar above the selection by default, flip below when
  // there is not enough room above. Positioning is recomputed after layout
  // using the rendered width to keep the bar centered on the selection.
  useLayoutEffect(() => {
    if (!visible || !anchor || !containerRef.current) {
      setPosition(null);
      return;
    }
    const rect = containerRef.current.getBoundingClientRect();
    const width = rect.width || 320;
    const selectionCenter = (anchor.left + anchor.right) / 2;
    const desiredLeft = Math.max(
      8,
      Math.min(window.innerWidth - width - 8, selectionCenter - width / 2),
    );
    const fitsAbove = anchor.top - VERTICAL_OFFSET - ESTIMATED_TOOLBAR_HEIGHT >= 8;
    const top = fitsAbove
      ? anchor.top - VERTICAL_OFFSET - rect.height
      : anchor.bottom + VERTICAL_OFFSET;
    setPosition({ top, left: desiredLeft, placement: fitsAbove ? "top" : "bottom" });
  }, [visible, anchor]);

  // Close the highlight picker if selection collapses.
  useEffect(() => {
    // Dropping the anchor, rather than hiding it, keeps a stale picker off the next selection.
    // eslint-disable-next-line react/react-compiler
    if (!visible) setHighlightAnchor(null);
  }, [visible]);

  const onHighlightClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    if (!handle) return;
    setHighlightAnchor(e.currentTarget.getBoundingClientRect());
  };

  const applyHighlight = useMemo(
    () => (color: string | null) => {
      if (!handle) {
        setHighlightAnchor(null);
        return;
      }
      handle.run((ctx) => {
        const view = ctx.get(editorViewCtx) as EditorView;
        if (!view) return;
        const { from, to } = view.state.selection;
        if (from === to) return;
        const markType = highlightMark.type(ctx);
        let tr = view.state.tr.removeMark(from, to, markType);
        if (color !== null) tr = tr.addMark(from, to, markType.create({ color }));
        view.dispatch(tr);
      });
      handle.focus();
      setHighlightAnchor(null);
    },
    [handle],
  );

  if (!handle || !visible) return null;

  return createPortal(
    <div
      ref={containerRef}
      role="toolbar"
      aria-label="Formatting"
      onMouseDown={(e) => {
        // Prevent ProseMirror from clearing the selection when clicking the toolbar.
        e.preventDefault();
      }}
      style={{
        position: "fixed",
        top: position?.top ?? -9999,
        left: position?.left ?? -9999,
        visibility: position ? "visible" : "hidden",
        zIndex: 60,
      }}
      className={cn(popoverShellClass, "flex items-center gap-0.5 px-1 py-1")}
    >
      <HeadingDropdown />
      <ToolbarSeparator />

      <ToolbarGroup>
        <ToolbarButton
          active={active.bold}
          onClick={() => toolbarCommands.toggleBold(handle)}
          label="Bold"
        >
          <TextB size={14} weight="bold" />
        </ToolbarButton>
        <ToolbarButton
          active={active.italic}
          onClick={() => toolbarCommands.toggleItalic(handle)}
          label="Italic"
        >
          <TextItalic size={14} weight="bold" />
        </ToolbarButton>
        <ToolbarButton
          active={active.underline}
          onClick={() => toolbarCommands.toggleUnderline(handle)}
          label="Underline"
        >
          <TextUnderline size={14} weight="bold" />
        </ToolbarButton>
        <ToolbarButton
          active={active.strike}
          onClick={() => toolbarCommands.toggleStrike(handle)}
          label="Strikethrough"
        >
          <TextStrikethrough size={14} weight="bold" />
        </ToolbarButton>
        <ToolbarButton
          active={active.code}
          onClick={() => toolbarCommands.toggleInlineCode(handle)}
          label="Inline code"
        >
          <Code size={14} weight="bold" />
        </ToolbarButton>
        <ToolbarButton
          active={active.link || linkAnchor !== null}
          onClick={(e) => setLinkAnchor(e.currentTarget.getBoundingClientRect())}
          label="Link"
        >
          <Link size={14} weight="bold" />
        </ToolbarButton>
      </ToolbarGroup>

      <ToolbarSeparator />

      <ToolbarGroup>
        <ToolbarButton onClick={onHighlightClick} label="Highlight">
          <Highlighter size={14} weight="bold" />
        </ToolbarButton>
        <ToolbarButton onClick={() => toolbarCommands.triggerMention(handle)} label="Mention">
          <At size={14} weight="bold" />
        </ToolbarButton>
        {handle.triggerComment && (
          <ToolbarButton
            onClick={() => {
              setCommentSnapshot(anchor);
              handle.triggerComment?.();
            }}
            label="Comment on selection"
          >
            <ChatCircle size={14} weight="bold" />
          </ToolbarButton>
        )}
      </ToolbarGroup>

      {highlightAnchor && (
        <HighlightPicker
          anchorRect={highlightAnchor}
          onSelect={applyHighlight}
          onClose={() => setHighlightAnchor(null)}
        />
      )}

      {linkAnchor && (
        <LinkPrompt handle={handle} anchorRect={linkAnchor} onClose={() => setLinkAnchor(null)} />
      )}
    </div>,
    document.body,
  );
}
