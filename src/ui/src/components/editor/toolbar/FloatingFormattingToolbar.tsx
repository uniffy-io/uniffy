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
import { useOverlayEscape } from "@/shared/hooks/useOverlayEscape";
import { subscribeSelection } from "@/components/editor/utils/selectionVersionPlugin";
import { useActiveMarks } from "@/components/editor/toolbar/useActiveMarks";
import { toolbarCommands } from "@/components/editor/toolbar/toolbarCommands";
import {
  ToolbarButton,
  ToolbarGroup,
  ToolbarSeparator,
} from "@/components/editor/toolbar/ToolbarButton";
import { HeadingDropdown } from "@/components/editor/toolbar/HeadingDropdown";
import { HighlightPicker } from "@/components/editor/plugins/highlight/HighlightPicker";
import { highlightMark } from "@/components/editor/plugins/highlight";
import { LinkPrompt } from "@/components/editor/toolbar/LinkPrompt";

interface SelectionAnchor {
  from: number;
  to: number;
  top: number;
  bottom: number;
  left: number;
  right: number;
}

const VERTICAL_OFFSET = 8;

function readSelectionAnchor(handle: EditorHandle | null): SelectionAnchor | null {
  if (!handle) return null;
  const { view } = handle;
  if (!view || view.isDestroyed) return null;
  const { state } = view;
  const { from, to, empty } = state.selection;
  if (empty || "node" in state.selection) return null;
  try {
    const start = view.coordsAtPos(from);
    const end = view.coordsAtPos(to);
    return {
      from,
      to,
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
  return (
    a.from === b.from &&
    a.to === b.to &&
    a.top === b.top &&
    a.bottom === b.bottom &&
    a.left === b.left &&
    a.right === b.right
  );
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

export function FloatingFormattingToolbar({
  showOnSelection = true,
}: {
  showOnSelection?: boolean;
}) {
  const handle = useEditorHandle();
  const store = useMemo(() => createAnchorStore(handle), [handle]);
  const anchor = useSyncExternalStore(store.subscribe, store.getSnapshot, () => null);

  if (!handle || !anchor) return null;

  return (
    <SelectionFormattingToolbar
      key={`${anchor.from}:${anchor.to}:${showOnSelection}`}
      handle={handle}
      anchor={anchor}
      showOnSelection={showOnSelection}
    />
  );
}

function SelectionFormattingToolbar({
  handle,
  anchor,
  showOnSelection,
}: {
  handle: EditorHandle;
  anchor: SelectionAnchor;
  showOnSelection: boolean;
}) {
  const active = useActiveMarks();
  const [highlightAnchor, setHighlightAnchor] = useState<DOMRect | null>(null);
  const [linkAnchor, setLinkAnchor] = useState<DOMRect | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const toolbarMouseEvents = useRef(new WeakSet<Event>());
  const [position, setPosition] = useState<{
    top: number;
    left: number;
  } | null>(null);
  const [contextPosition, setContextPosition] = useState<{
    x: number;
    y: number;
    keyboard: boolean;
  } | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const visible = !dismissed && (showOnSelection || contextPosition !== null);

  useEffect(() => {
    const { view } = handle;
    const open = (event: MouseEvent | KeyboardEvent) => {
      const selection = readSelectionAnchor(handle);
      if (!view.editable || !selection) return;
      event.preventDefault();
      event.stopPropagation();
      const keyboard =
        event instanceof KeyboardEvent || (event.clientX === 0 && event.clientY === 0);
      setContextPosition({
        x: keyboard ? selection.left : event.clientX,
        y: keyboard ? selection.bottom : event.clientY,
        keyboard,
      });
      setDismissed(false);
      setHighlightAnchor(null);
      setLinkAnchor(null);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) open(event);
    };
    view.dom.addEventListener("contextmenu", open);
    view.dom.addEventListener("keydown", onKeyDown);
    return () => {
      view.dom.removeEventListener("contextmenu", open);
      view.dom.removeEventListener("keydown", onKeyDown);
    };
  }, [handle]);

  useOverlayEscape(() => {
    setDismissed(true);
    handle.focus();
  }, visible);

  useEffect(() => {
    if (!visible) return;
    const dismiss = () => setDismissed(true);
    const onMouseDown = (event: MouseEvent) => {
      if (!toolbarMouseEvents.current.has(event)) dismiss();
    };
    document.addEventListener("mousedown", onMouseDown);
    window.addEventListener("scroll", dismiss, true);
    window.addEventListener("resize", dismiss);
    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("scroll", dismiss, true);
      window.removeEventListener("resize", dismiss);
    };
  }, [visible]);

  useEffect(() => {
    if (contextPosition?.keyboard) containerRef.current?.querySelector("button")?.focus();
  }, [contextPosition]);

  useLayoutEffect(() => {
    if (!visible || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const desiredLeft = contextPosition?.x ?? (anchor.left + anchor.right - rect.width) / 2;
    const below = (contextPosition?.y ?? anchor.bottom) + VERTICAL_OFFSET;
    const above = (contextPosition?.y ?? anchor.top) - VERTICAL_OFFSET - rect.height;
    const desiredTop = contextPosition
      ? below + rect.height <= window.innerHeight - 8
        ? below
        : above
      : above >= 8
        ? above
        : below;
    setPosition({
      top: Math.max(8, Math.min(window.innerHeight - rect.height - 8, desiredTop)),
      left: Math.max(8, Math.min(window.innerWidth - rect.width - 8, desiredLeft)),
    });
  }, [visible, anchor, contextPosition]);

  const onHighlightClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    setHighlightAnchor(e.currentTarget.getBoundingClientRect());
  };

  const applyHighlight = useMemo(
    () => (color: string | null) => {
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

  if (!visible) return null;

  return createPortal(
    <div
      ref={containerRef}
      role="toolbar"
      aria-label="Formatting"
      onMouseDown={(e) => {
        // Prevent ProseMirror from clearing the selection when clicking the toolbar.
        e.preventDefault();
        // Portaled popovers belong to this toolbar even though they sit outside its DOM tree.
        toolbarMouseEvents.current.add(e.nativeEvent);
      }}
      style={{
        position: "fixed",
        top: position?.top ?? -9999,
        left: position?.left ?? -9999,
        visibility: position ? "visible" : "hidden",
        // Same tier as the toolbar popovers so it clears the expandable editor overlay.
        zIndex: 1000,
      }}
      className={cn(
        popoverShellClass,
        "flex w-max max-w-[calc(100vw-16px)] flex-wrap items-center gap-0.5 px-1 py-1",
        "[&_button]:focus-ring max-lg:[&_button]:h-11 max-lg:[&_button]:min-w-11",
      )}
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
              setDismissed(true);
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
