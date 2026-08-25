// Inline-only markup so the card stays HTML-valid as a descendant of `<p>`.
import { Graph } from "@phosphor-icons/react";
import { navigateTo } from "@/shared/utils/navigation";

/** Footer action opening the knowledge graph focused on this URN. Router-free
 * navigation because previews also mount in editor NodeView roots. */
export function ShowInGraphButton({ urn }: { urn: string }) {
  return (
    <button
      onMouseDown={(e) => {
        e.preventDefault();
        e.stopPropagation();
        navigateTo(`/library/graph?focus=${encodeURIComponent(urn)}`);
      }}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
      className="p-1 rounded-md hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
      title="Show in graph"
    >
      <Graph size={11} weight="bold" />
    </button>
  );
}
