/**
 * Pure op model for structural PDF editing. Order = document order; deletion =
 * removal from the array; `originalIndex` always points at the source document.
 */

export type PageRotation = 0 | 90 | 180 | 270;

export interface PageOp {
  originalIndex: number;
  rotation: PageRotation;
}

export type PageOpsState = PageOp[];

export function initPageOps(pageCount: number): PageOpsState {
  return Array.from({ length: pageCount }, (_, index) => ({
    originalIndex: index,
    rotation: 0 as PageRotation,
  }));
}

function addRotation(rotation: PageRotation, delta: number): PageRotation {
  return ((((rotation + delta) % 360) + 360) % 360) as PageRotation;
}

/** `indices` are positions in the CURRENT order; `direction` 1 = clockwise. */
export function rotatePages(
  state: PageOpsState,
  indices: number[],
  direction: 1 | -1,
): PageOpsState {
  const targets = new Set(indices);
  return state.map((op, index) =>
    targets.has(index) ? { ...op, rotation: addRotation(op.rotation, direction * 90) } : op,
  );
}

export function deletePages(state: PageOpsState, indices: number[]): PageOpsState {
  const targets = new Set(indices);
  return state.filter((_, index) => !targets.has(index));
}

export function movePage(state: PageOpsState, from: number, to: number): PageOpsState {
  if (state.length === 0) return state;
  const clampedFrom = Math.max(0, Math.min(from, state.length - 1));
  const clampedTo = Math.max(0, Math.min(to, state.length - 1));
  if (clampedFrom === clampedTo) return [...state];
  const next = [...state];
  const [moved] = next.splice(clampedFrom, 1);
  next.splice(clampedTo, 0, moved);
  return next;
}

/** Selected ops in current document order, for saving as a standalone file. */
export function extractPages(state: PageOpsState, indices: number[]): PageOpsState {
  const targets = new Set(indices);
  return state.filter((_, index) => targets.has(index)).map((op) => ({ ...op }));
}
