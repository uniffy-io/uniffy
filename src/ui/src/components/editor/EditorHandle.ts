import { createContext, useContext } from "react";
import type { Crepe } from "@milkdown/crepe";
import type { Ctx } from "@milkdown/kit/ctx";
import type { EditorView } from "@milkdown/prose/view";

export interface EditorHandle {
  readonly crepe: Crepe;
  readonly view: EditorView;
  readonly scope: object;
  run<T>(fn: (ctx: Ctx) => T): T | undefined;
  focus(): void;
  flushMarkdownMirror?: () => void;
  /** Open the inline-comment popover at the current selection. Present only when comments are enabled. */
  triggerComment?: () => void;
}

export const EditorHandleContext = createContext<EditorHandle | null>(null);

export function useEditorHandle(): EditorHandle | null {
  return useContext(EditorHandleContext);
}
