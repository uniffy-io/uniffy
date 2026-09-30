import { useEffect, useRef, useState } from "react";
import { Trash, Check } from "@phosphor-icons/react";
import { editorViewCtx } from "@milkdown/core";
import { linkSchema } from "@milkdown/kit/preset/commonmark";
import type { EditorView } from "@milkdown/prose/view";
import type { EditorHandle } from "@/components/editor/EditorHandle";
import { PortalMenu } from "@/components/ui/portal-menu";
import { Input } from "@/components/ui/input";

interface LinkPromptProps {
  handle: EditorHandle;
  anchorRect: DOMRect;
  onClose: () => void;
}

/** A selection spanning multiple links edits the first URL, matching Crepe's tooltip. */
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
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [href, setHref] = useState(() => readCurrentHref(handle));
  const hasExisting = href !== "";

  useEffect(() => {
    // Portal menus measure while hidden, so focus after their first layout.
    const frame = requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
    return () => cancelAnimationFrame(frame);
  }, []);

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

  return (
    <PortalMenu
      open
      onClose={onClose}
      position={{ x: anchorRect.left, y: anchorRect.bottom + 6 }}
      className="z-[1000] w-80 p-2"
    >
      <div
        role="dialog"
        className="flex items-center gap-2"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <Input
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
          className="h-11 min-w-0 flex-1 px-2 text-sm lg:h-8"
        />
        <button
          type="button"
          onClick={submit}
          className="focus-ring flex h-11 w-11 shrink-0 items-center justify-center rounded text-primary hover:bg-primary/10 transition-colors lg:h-8 lg:w-8"
          aria-label="Apply link"
          title="Apply link"
        >
          <Check size={16} weight="bold" />
        </button>
        {hasExisting && (
          <button
            type="button"
            onClick={() => apply(null)}
            className="focus-ring flex h-11 w-11 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors lg:h-8 lg:w-8"
            aria-label="Remove link"
            title="Remove link"
          >
            <Trash size={16} weight="bold" />
          </button>
        )}
      </div>
    </PortalMenu>
  );
}
