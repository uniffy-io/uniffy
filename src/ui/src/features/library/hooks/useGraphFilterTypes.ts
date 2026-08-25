import { useMemo } from "react";
import { useAppSelector } from "@/app/hooks";
import { parseUrn } from "@/shared/utils/urn";
import type { UrnType } from "@/shared/utils/urnTypes";

/** Content types present in the loaded knowledge graph, most connected first. */
export function useGraphFilterTypes(): UrnType[] {
  const edges = useAppSelector((state) => state.libraryGraph.edges);
  return useMemo(() => {
    const counts = new Map<UrnType, number>();
    for (const edge of edges) {
      for (const urn of [edge.sourceUrn, edge.targetUrn]) {
        const parsed = parseUrn(urn);
        if (parsed.isValid) counts.set(parsed.type, (counts.get(parsed.type) ?? 0) + 1);
      }
    }
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([type]) => type);
  }, [edges]);
}
