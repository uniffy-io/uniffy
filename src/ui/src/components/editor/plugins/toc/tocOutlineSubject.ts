/**
 * Per-view outline broadcast. The PM plugin walks top-level heading nodes
 * after every doc change and publishes the resulting entries here; every
 * ToC NodeView mounted on the same EditorView subscribes and re-renders.
 *
 * Kept module-level (no React context) because NodeViews mount their own
 * React roots outside the main provider tree.
 */
import type { EditorView } from '@milkdown/prose/view';

export interface HeadingEntry {
    /** 1-6, as declared by the heading node `level` attribute */
    level: number;
    /** Trimmed heading text */
    text: string;
    /** Final anchor slug, occurrence-suffixed when duplicates exist */
    slug: string;
}

type Listener = (entries: HeadingEntry[]) => void;

interface Subject {
    entries: HeadingEntry[];
    listeners: Set<Listener>;
}

const subjects = new WeakMap<EditorView, Subject>();

/** Stable reference for the "no outline yet" case so React snapshot
 *  identity holds and useSyncExternalStore does not loop. */
const EMPTY_ENTRIES: HeadingEntry[] = [];

function ensure(view: EditorView): Subject {
    let s = subjects.get(view);
    if (!s) {
        s = { entries: EMPTY_ENTRIES, listeners: new Set() };
        subjects.set(view, s);
    }
    return s;
}

export function getOutline(view: EditorView): HeadingEntry[] {
    return subjects.get(view)?.entries ?? EMPTY_ENTRIES;
}

export function setOutline(view: EditorView, entries: HeadingEntry[]) {
    const s = ensure(view);
    s.entries = entries;
    s.listeners.forEach((cb) => cb(entries));
}

export function subscribeOutline(view: EditorView, cb: Listener): () => void {
    const s = ensure(view);
    s.listeners.add(cb);
    return () => {
        s.listeners.delete(cb);
    };
}
