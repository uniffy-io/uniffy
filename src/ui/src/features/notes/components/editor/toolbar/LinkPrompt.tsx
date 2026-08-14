import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Trash, Check } from "@phosphor-icons/react";
import { editorViewCtx } from "@milkdown/core";
import { linkSchema } from "@milkdown/kit/preset/commonmark";
import type { EditorView } from "@milkdown/prose/view";
import type { EditorHandle } from "@/components/editor/EditorHandle";

interface LinkPromptProps {
  handle: EditorHandle;
  anchorRect: DOMRect;
  onClose: () => void;
}

/**
 * Read the existing link href on the current selection, if any. We only
 * surface a single href - if the selection spans multiple links, the first
 * one wins, which is the same behavior as Crepe's link tooltip.
 */
function readCurrentHref(handle: EditorHandle): string {
  let found = "";
  handle.run((ctx) => {
    const view = ctx.get(editorViewCtx) as EditorView;
    if (!view) return;
    const markType = linkSchema.type(ctx);
    const { from, to } = view.state.selection;
    view.state.doc.nodesBetween(from, to, (node) => {
      if (found) return false;
      const link = node.marks.find((m) => m.type === markType);
      if (link) {
        const href = link.attrs.href;
        if (typeof href === "string") found = href;
        return false;
      }
    });
  });
  return found;
}

function normalizeHref(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return "";
  if (/^(https?:|mailto:|tel:|\/|#)/i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

export function LinkPrompt({ handle, anchorRect, onClose }: LinkPromptProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [href, setHref] = useState(() => readCurrentHref(handle));
  const hasExisting = href !== "";

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  useEffect(() => {
    const onMouseDown = (e: MouseEvent) => {
      if (containerRef.current?.contains(e.target as Node)) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    document.addEventListener("mousedown", onMouseDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  const apply = (nextHref: string | null) => {
    handle.run((ctx) => {
      const view = ctx.get(editorViewCtx) as EditorView;
      if (!view) return;
      const { from, to } = view.state.selection;
      if (from === to) return;
      const markType = linkSchema.type(ctx);
      let tr = view.state.tr.removeMark(from, to, markType);
      if (nextHref) tr = tr.addMark(from, to, markType.create({ href: nextHref, title: null }));
      view.dispatch(tr);
    });
    handle.focus();
    onClose();
  };

  const submit = () => {
    const normalized = normalizeHref(href);
    if (!normalized) {
      apply(null);
      return;
    }
    apply(normalized);
  };

  const top = anchorRect.bottom + 6;
  const left = Math.max(8, Math.min(window.innerWidth - 320, anchorRect.left));

  return createPortal(
    <div
      ref={containerRef}
      role="dialog"
      style={{ position: "fixed", top, left, zIndex: 1000, width: 320 }}
      className="rounded-md border border-border bg-card text-card-foreground shadow-lg p-2"
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div className="flex items-center gap-2">
        <input
          ref={inputRef}
          type="text"
          value={href}
          onChange={(e) => setHref(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              submit();
            }
          }}
          placeholder="Paste a link"
          className="flex-1 min-w-0 bg-transparent border border-border rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
        />
        <button
          type="button"
          onClick={submit}
          className="p-1.5 rounded text-primary hover:bg-primary/10 transition-colors"
          aria-label="Apply link"
          title="Apply link"
        >
          <Check size={16} weight="bold" />
        </button>
        {hasExisting && (
          <button
            type="button"
            onClick={() => apply(null)}
            className="p-1.5 rounded text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors"
            aria-label="Remove link"
            title="Remove link"
          >
            <Trash size={16} weight="bold" />
          </button>
        )}
      </div>
    </div>,
    document.body,
  );
}
