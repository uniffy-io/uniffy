import { Plugin } from '@milkdown/prose/state';
import type { EditorView } from '@milkdown/prose/view';
import { $prose } from '@milkdown/kit/utils';

// Crepe's slash menu keeps a flat item index: ArrowDown/ArrowUp step it by 1
// and ArrowLeft/ArrowRight jump between groups (its hidden tab strip). Our CSS
// renders the items as a two column grid, so remap: Left/Right = one flat step
// in reading order, Up/Down = one visual row (column preserved, clamped on
// single-item rows). The menu owns no public index setter and listens on
// window in the capture phase only while shown. This listener is registered at
// editor creation, so it always sits earlier in the window capture list and
// runs first. It consumes the physical arrow key and re-dispatches marked
// synthetic ArrowDown/ArrowUp steps that drive the menu's own index; Vue
// batches the re-render, so multi-step moves paint once.

const syntheticStep = Symbol('slashMenuSyntheticStep');

type MarkedKeyboardEvent = KeyboardEvent & { [syntheticStep]?: boolean };

const ARROW_KEYS = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);

function findVisibleMenu(view: EditorView): HTMLElement | null {
  const menu = view.dom.parentElement?.querySelector<HTMLElement>('.milkdown-slash-menu');
  return menu && menu.dataset.show === 'true' ? menu : null;
}

function readRows(menu: HTMLElement): number[][] {
  const rows: number[][] = [];
  for (const group of menu.querySelectorAll('.menu-group')) {
    let rowTop: number | null = null;
    for (const item of group.querySelectorAll<HTMLElement>('li[data-index]')) {
      const index = Number(item.dataset.index);
      if (!Number.isInteger(index)) continue;
      const top = item.offsetTop;
      if (rowTop !== null && Math.abs(top - rowTop) <= 1) {
        rows[rows.length - 1].push(index);
      } else {
        rows.push([index]);
        rowTop = top;
      }
    }
  }
  return rows;
}

function readActiveIndex(menu: HTMLElement): number {
  const active = menu.querySelector<HTMLElement>('li.hover[data-index]');
  const index = active ? Number(active.dataset.index) : 0;
  return Number.isInteger(index) ? index : 0;
}

function dispatchSteps(delta: number): void {
  const key = delta > 0 ? 'ArrowDown' : 'ArrowUp';
  for (let i = 0; i < Math.abs(delta); i += 1) {
    const step: MarkedKeyboardEvent = new KeyboardEvent('keydown', { key });
    step[syntheticStep] = true;
    window.dispatchEvent(step);
  }
}

export const slashMenuGridNavigation = $prose(() =>
  new Plugin({
    view: (editorView) => {
      const onKeydown = (event: MarkedKeyboardEvent) => {
        if (event[syntheticStep] || !ARROW_KEYS.has(event.key)) return;
        const menu = findVisibleMenu(editorView);
        if (!menu) return;

        event.preventDefault();
        event.stopImmediatePropagation();

        if (event.key === 'ArrowRight') {
          dispatchSteps(1);
          return;
        }
        if (event.key === 'ArrowLeft') {
          dispatchSteps(-1);
          return;
        }

        const rows = readRows(menu);
        const current = readActiveIndex(menu);
        const rowPosition = rows.findIndex((row) => row.includes(current));
        if (rowPosition === -1) return;
        const targetRow = rows[rowPosition + (event.key === 'ArrowDown' ? 1 : -1)];
        if (!targetRow) return;
        const column = rows[rowPosition].indexOf(current);
        const target = targetRow[Math.min(column, targetRow.length - 1)];
        dispatchSteps(target - current);
      };

      window.addEventListener('keydown', onKeydown, { capture: true });
      return {
        destroy: () => {
          window.removeEventListener('keydown', onKeydown, { capture: true });
        },
      };
    },
  }),
);
