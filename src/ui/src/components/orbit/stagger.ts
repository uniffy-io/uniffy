import type { CSSProperties } from "react";

/** Staggers a block into view; `index` is its order on the screen. */
export function stagger(index: number): { className: string; style: CSSProperties } {
  return { className: "orbit-rise", style: { "--i": index } as CSSProperties };
}
