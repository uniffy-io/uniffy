import { useMemo, useSyncExternalStore } from 'react';
import { commandsCtx } from '@milkdown/core';
import {
  isMarkSelectedCommand,
  isNodeSelectedCommand,
  strongSchema,
  emphasisSchema,
  inlineCodeSchema,
  linkSchema,
  bulletListSchema,
  orderedListSchema,
  codeBlockSchema,
} from '@milkdown/kit/preset/commonmark';
import { strikethroughSchema } from '@milkdown/kit/preset/gfm';
import type { Ctx } from '@milkdown/kit/ctx';
import { useEditorHandle, type EditorHandle } from '@/components/editor/EditorHandle';
import { subscribeSelection } from '@/components/editor/utils/selectionVersionPlugin';
import { isUnderlineActive } from '@/components/editor/plugins/underline';

export interface ActiveMarks {
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strike: boolean;
  code: boolean;
  link: boolean;
  bulletList: boolean;
  orderedList: boolean;
  codeBlock: boolean;
  headingLevel: number | null;
}

const INACTIVE: ActiveMarks = {
  bold: false,
  italic: false,
  underline: false,
  strike: false,
  code: false,
  link: false,
  bulletList: false,
  orderedList: false,
  codeBlock: false,
  headingLevel: null,
};

function readActive(ctx: Ctx): Omit<ActiveMarks, 'headingLevel'> {
  const commands = ctx.get(commandsCtx);
  return {
    bold: commands.call(isMarkSelectedCommand.key, strongSchema.type(ctx)),
    italic: commands.call(isMarkSelectedCommand.key, emphasisSchema.type(ctx)),
    underline: isUnderlineActive(ctx),
    strike: commands.call(isMarkSelectedCommand.key, strikethroughSchema.type(ctx)),
    code: commands.call(isMarkSelectedCommand.key, inlineCodeSchema.type(ctx)),
    link: commands.call(isMarkSelectedCommand.key, linkSchema.type(ctx)),
    bulletList: commands.call(isNodeSelectedCommand.key, bulletListSchema.type(ctx)),
    orderedList: commands.call(isNodeSelectedCommand.key, orderedListSchema.type(ctx)),
    codeBlock: commands.call(isNodeSelectedCommand.key, codeBlockSchema.type(ctx)),
  };
}

function readHeadingLevel(handle: EditorHandle): number | null {
  const { $from } = handle.view.state.selection;
  for (let d = $from.depth; d > 0; d--) {
    const node = $from.node(d);
    if (node.type.name === 'heading') {
      const level = Number(node.attrs.level);
      return Number.isFinite(level) ? level : null;
    }
  }
  return null;
}

function snapshotsEqual(a: ActiveMarks, b: ActiveMarks): boolean {
  return (
    a.bold === b.bold &&
    a.italic === b.italic &&
    a.underline === b.underline &&
    a.strike === b.strike &&
    a.code === b.code &&
    a.link === b.link &&
    a.bulletList === b.bulletList &&
    a.orderedList === b.orderedList &&
    a.codeBlock === b.codeBlock &&
    a.headingLevel === b.headingLevel
  );
}

interface Store {
  subscribe: (cb: () => void) => () => void;
  getSnapshot: () => ActiveMarks;
}

function createStore(handle: EditorHandle | null): Store {
  if (!handle) {
    return {
      subscribe: () => () => {},
      getSnapshot: () => INACTIVE,
    };
  }

  let cached: ActiveMarks = INACTIVE;
  let needsRecompute = true;

  const compute = (): ActiveMarks => {
    let next: ActiveMarks = INACTIVE;
    handle.run((ctx) => {
      next = { ...readActive(ctx), headingLevel: readHeadingLevel(handle) };
    });
    return next;
  };

  return {
    subscribe: (cb) =>
      subscribeSelection(handle.scope, () => {
        needsRecompute = true;
        cb();
      }),
    getSnapshot: () => {
      if (!needsRecompute) return cached;
      const next = compute();
      needsRecompute = false;
      if (!snapshotsEqual(cached, next)) cached = next;
      return cached;
    },
  };
}

export function useActiveMarks(): ActiveMarks {
  const handle = useEditorHandle();
  const store = useMemo(() => createStore(handle), [handle]);
  return useSyncExternalStore(store.subscribe, store.getSnapshot, () => INACTIVE);
}
