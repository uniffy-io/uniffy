/**
 * Mind map constants - colors, layout dimensions, and direction types.
 *
 * Extracted to avoid react-refresh warnings
 * when mixing component and non-component exports.
 */

/** Layout direction for mind map trees. */
export type MindMapDirection = 'right' | 'down' | 'left' | 'up';

/** Ordered list of directions for cycling with the rotate action. */
export const MINDMAP_DIRECTIONS: MindMapDirection[] = ['right', 'down', 'left', 'up'];

/** Branch color palette. Each top-level child of the root gets a distinct color. */
export const MINDMAP_BRANCH_COLORS = [
  '#3b82f6', // blue-500
  '#10b981', // emerald-500
  '#f59e0b', // amber-500
  '#ef4444', // red-500
  '#8b5cf6', // violet-500
  '#ec4899', // pink-500
  '#06b6d4', // cyan-500
  '#f97316', // orange-500
  '#14b8a6', // teal-500
  '#6366f1', // indigo-500
] as const;

/** Horizontal gap between parent and child columns (px). */
export const MINDMAP_HORIZONTAL_GAP = 200;

/** Vertical gap between sibling nodes (px). */
export const MINDMAP_VERTICAL_GAP = 14;

/** Default branch node dimensions. */
export const MINDMAP_NODE_WIDTH = 180;
export const MINDMAP_NODE_HEIGHT = 38;

/** Root node dimensions (slightly larger). */
export const MINDMAP_ROOT_WIDTH = 200;
export const MINDMAP_ROOT_HEIGHT = 46;
