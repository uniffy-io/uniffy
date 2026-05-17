import { commandsCtx, editorViewCtx } from '@milkdown/core';
import {
  toggleStrongCommand,
  toggleEmphasisCommand,
  toggleInlineCodeCommand,
  wrapInHeadingCommand,
  wrapInBulletListCommand,
  wrapInOrderedListCommand,
  createCodeBlockCommand,
  turnIntoTextCommand,
} from '@milkdown/kit/preset/commonmark';
import { toggleStrikethroughCommand, createTable } from '@milkdown/kit/preset/gfm';
import { undoCommand, redoCommand } from '@milkdown/plugin-history';
import type { Ctx } from '@milkdown/kit/ctx';
import type { EditorView } from '@milkdown/prose/view';
import { triggerMentionAtCursor } from '@/components/editor/plugins/mention';
import { toggleUnderline } from '@/components/editor/plugins/underline';
import type { EditorHandle } from '@/components/editor/EditorHandle';

function call<T>(handle: EditorHandle, fn: (ctx: Ctx) => T) {
  handle.run(fn);
  handle.focus();
}

export const toolbarCommands = {
  toggleBold: (h: EditorHandle) => call(h, (ctx) => ctx.get(commandsCtx).call(toggleStrongCommand.key)),
  toggleItalic: (h: EditorHandle) => call(h, (ctx) => ctx.get(commandsCtx).call(toggleEmphasisCommand.key)),
  toggleUnderline: (h: EditorHandle) => call(h, (ctx) => toggleUnderline(ctx)),
  toggleStrike: (h: EditorHandle) => call(h, (ctx) => ctx.get(commandsCtx).call(toggleStrikethroughCommand.key)),
  toggleInlineCode: (h: EditorHandle) => call(h, (ctx) => ctx.get(commandsCtx).call(toggleInlineCodeCommand.key)),
  setHeading: (h: EditorHandle, level: number) =>
    call(h, (ctx) => ctx.get(commandsCtx).call(wrapInHeadingCommand.key, level)),
  setParagraph: (h: EditorHandle) => call(h, (ctx) => ctx.get(commandsCtx).call(turnIntoTextCommand.key)),
  toggleBulletList: (h: EditorHandle) => call(h, (ctx) => ctx.get(commandsCtx).call(wrapInBulletListCommand.key)),
  toggleOrderedList: (h: EditorHandle) => call(h, (ctx) => ctx.get(commandsCtx).call(wrapInOrderedListCommand.key)),
  insertCodeBlock: (h: EditorHandle) => call(h, (ctx) => ctx.get(commandsCtx).call(createCodeBlockCommand.key)),
  insertTable: (h: EditorHandle, rows: number, cols: number) =>
    call(h, (ctx) => {
      const view = ctx.get(editorViewCtx) as EditorView;
      if (!view) return;
      const tableNode = createTable(ctx, rows, cols);
      if (!tableNode) return;
      const tr = view.state.tr.replaceSelectionWith(tableNode);
      view.dispatch(tr);
    }),
  undo: (h: EditorHandle) => call(h, (ctx) => ctx.get(commandsCtx).call(undoCommand.key)),
  redo: (h: EditorHandle) => call(h, (ctx) => ctx.get(commandsCtx).call(redoCommand.key)),
  triggerMention: (h: EditorHandle) =>
    call(h, (ctx) => {
      const view = ctx.get(editorViewCtx) as EditorView;
      if (view) triggerMentionAtCursor(view);
    }),
};
