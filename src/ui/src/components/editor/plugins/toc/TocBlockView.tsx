import { useCallback, useMemo, useState, useSyncExternalStore } from "react";
import { Gear, ListBullets } from "@phosphor-icons/react";
import type { EditorView } from "@milkdown/prose/view";
import { cn } from "@/shared/utils/cn";
import { useAppSelector } from "@/app/hooks";
import { useBreakpoint } from "@/shared/hooks/useBreakpoint";
import {
  getOutline,
  subscribeOutline,
  type HeadingEntry,
} from "@/components/editor/plugins/toc/tocOutlineSubject";
import { TocConfigPopover } from "@/components/editor/plugins/toc/TocConfigPopover";
import type { TocAttrs } from "@/components/editor/plugins/toc/tocTypes";

interface TocBlockViewProps {
  view: EditorView;
  getPos: () => number | undefined;
  attrs: TocAttrs;
  selected: boolean;
  editable: boolean;
}

interface TreeNode {
  entry: HeadingEntry;
  children: TreeNode[];
}

function buildTree(entries: HeadingEntry[]): TreeNode[] {
  const roots: TreeNode[] = [];
  const stack: TreeNode[] = [];
  for (const entry of entries) {
    const node: TreeNode = { entry, children: [] };
    while (stack.length > 0 && stack[stack.length - 1].entry.level >= entry.level) {
      stack.pop();
    }
    if (stack.length === 0) {
      roots.push(node);
    } else {
      stack[stack.length - 1].children.push(node);
    }
    stack.push(node);
  }
  return roots;
}

function TocEntryLink({ entry, indent }: { entry: HeadingEntry; indent: number }) {
  return (
    <a
      href={`#${entry.slug}`}
      className={cn("toc-block__entry", `level-${entry.level}`)}
      style={{ paddingLeft: `${0.5 + indent * 0.875}rem` }}
      title={entry.text}
    >
      {entry.text}
    </a>
  );
}

function FlatList({
  entries,
  minPresent,
  bullets,
}: {
  entries: HeadingEntry[];
  minPresent: number;
  bullets: TocAttrs["bullets"];
}) {
  const ListTag: "ol" | "ul" = bullets === "number" ? "ol" : "ul";
  return (
    <ListTag className={cn("toc-block__list", `is-bullets-${bullets}`)}>
      {entries.map((entry, idx) => (
        <li key={`${entry.slug}-${idx}`}>
          <TocEntryLink entry={entry} indent={entry.level - minPresent} />
        </li>
      ))}
    </ListTag>
  );
}

function NestedTree({ nodes, bullets }: { nodes: TreeNode[]; bullets: TocAttrs["bullets"] }) {
  const ListTag: "ol" | "ul" = bullets === "number" ? "ol" : "ul";
  return (
    <ListTag className={cn("toc-block__list", `is-bullets-${bullets}`)}>
      {nodes.map((node, idx) => (
        <li key={`${node.entry.slug}-${idx}`}>
          <TocEntryLink entry={node.entry} indent={0} />
          {node.children.length > 0 && <NestedTree nodes={node.children} bullets={bullets} />}
        </li>
      ))}
    </ListTag>
  );
}

export function TocBlockView({ view, getPos, attrs, selected, editable }: TocBlockViewProps) {
  const subscribe = useCallback((cb: () => void) => subscribeOutline(view, () => cb()), [view]);
  const getSnapshot = useCallback(() => getOutline(view), [view]);
  const entries = useSyncExternalStore(subscribe, getSnapshot);

  const [popoverRect, setPopoverRect] = useState<DOMRect | null>(null);
  const { isMobile } = useBreakpoint();

  const noteTitle = useAppSelector((state) => {
    const id = state.notes?.currentNoteId;
    if (!id) return "";
    return state.notes?.notes?.[id]?.title ?? "";
  });

  const showPopover = selected && popoverRect !== null;

  const filtered = useMemo(
    () => entries.filter((e) => e.level >= attrs.min && e.level <= attrs.max),
    [entries, attrs.min, attrs.max],
  );

  const minPresent = filtered.length > 0 ? Math.min(...filtered.map((e) => e.level)) : attrs.min;

  const handleAttrChange = useCallback(
    (patch: Partial<TocAttrs>) => {
      const pos = getPos();
      if (pos === undefined) return;
      const nextAttrs: TocAttrs = { ...attrs, ...patch };
      const tr = view.state.tr.setNodeMarkup(pos, null, nextAttrs);
      view.dispatch(tr);
    },
    [view, getPos, attrs],
  );

  const body =
    filtered.length === 0 ? (
      <p className="toc-block__empty">Add a heading to see it here</p>
    ) : attrs.style === "nested" ? (
      <NestedTree nodes={buildTree(filtered)} bullets={attrs.bullets} />
    ) : (
      <FlatList entries={filtered} minPresent={minPresent} bullets={attrs.bullets} />
    );

  return (
    <div className="toc-block not-prose" role="navigation" aria-label="Table of contents">
      {editable && selected && (
        <div className="toc-block__pill" contentEditable={false}>
          <ListBullets size={13} weight="bold" />
          <span className="toc-block__pill-label">Table of Contents</span>
          {filtered.length > 0 && <span className="toc-block__pill-count">{filtered.length}</span>}
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              const rect = e.currentTarget.getBoundingClientRect();
              setPopoverRect((prev) => (prev ? null : rect));
            }}
            className="toc-block__pill-gear"
            title="Configure"
            aria-label="Configure table of contents"
          >
            <Gear size={14} weight="bold" />
          </button>
        </div>
      )}

      {noteTitle && <h2 className="toc-block__title">{noteTitle}</h2>}

      {isMobile && filtered.length > 0 ? (
        <details>
          <summary className="toc-block__summary">
            Show {filtered.length} heading{filtered.length === 1 ? "" : "s"}
          </summary>
          <div>{body}</div>
        </details>
      ) : (
        body
      )}

      {showPopover && popoverRect && (
        <TocConfigPopover
          anchorRect={popoverRect}
          attrs={attrs}
          onChange={handleAttrChange}
          onClose={() => setPopoverRect(null)}
        />
      )}
    </div>
  );
}
