import type { CSSProperties } from "react";

const ENTRANCE_STAGGER_MS = 25;
const ENTRANCE_STAGGER_CAP = 20;

/** Cascades card entrances across a grid, capped so a long list does not crawl in. */
export function entranceDelay(index: number): CSSProperties {
  return { animationDelay: `${Math.min(index, ENTRANCE_STAGGER_CAP) * ENTRANCE_STAGGER_MS}ms` };
}
