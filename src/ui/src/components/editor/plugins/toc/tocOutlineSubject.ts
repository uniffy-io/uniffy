/** Per-view outline broadcast — module-level because NodeViews mount their own React roots outside the main provider tree. */
import type { EditorView } from '@milkdown/prose/view';

export interface HeadingEntry {
    /** 1-6, as declared by the heading node `level` attribute. */
    level: number;
    text: string;
    /** Occurrence-suffixed slug for duplicate headings. */
    slug: string;
}

type Listener = (entries: HeadingEntry[]) => void;

interface Subject {
    entries: HeadingEntry[];
    listeners: Set<Listener>;
}

const subjects = new WeakMap<EditorView, Subject>();

/** Stable identity so `useSyncExternalStore` snapshots compare equal across renders. */
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
