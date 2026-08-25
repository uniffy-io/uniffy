import type { UrnMetadata } from "@uniffy/proto/search/v1/search_pb";
import { parseUrn, type UrnType } from "@/shared/utils/urn";
import { getUrnTypeBrandStops } from "@/config/theme/urnColors";
import { getContentTypeLabel } from "@/config/theme/contentTypes";

export interface GraphNode {
  /** The full URN - the only id unique across content types. */
  id: string;
  label: string;
  type: UrnType;
  urn: string;
  connections: number;
  color: string;
  x?: number;
  y?: number;
  vx?: number;
  vy?: number;
}

export interface GraphLink {
  source: string;
  target: string;
}

export interface GraphData {
  nodes: GraphNode[];
  links: GraphLink[];
}

export interface ContentGraphEdgeInput {
  sourceUrn: string;
  targetUrn: string;
}

export function buildGraphData(
  edges: ContentGraphEdgeInput[],
  urnMetadata?: Map<string, Omit<UrnMetadata, "$typeName">>,
): GraphData {
  const links: GraphLink[] = [];
  const seenPairs = new Set<string>();
  const degree = new Map<string, number>();
  const urns = new Set<string>();

  for (const edge of edges) {
    if (edge.sourceUrn === edge.targetUrn) continue;
    if (!parseUrn(edge.sourceUrn).isValid || !parseUrn(edge.targetUrn).isValid) continue;
    const pairKey = `${edge.sourceUrn}\u0000${edge.targetUrn}`;
    if (seenPairs.has(pairKey)) continue;
    seenPairs.add(pairKey);

    links.push({ source: edge.sourceUrn, target: edge.targetUrn });
    urns.add(edge.sourceUrn);
    urns.add(edge.targetUrn);
    degree.set(edge.sourceUrn, (degree.get(edge.sourceUrn) ?? 0) + 1);
    degree.set(edge.targetUrn, (degree.get(edge.targetUrn) ?? 0) + 1);
  }

  const nodes: GraphNode[] = [];
  for (const urn of urns) {
    const parsed = parseUrn(urn);
    const meta = urnMetadata?.get(urn);
    nodes.push({
      id: urn,
      urn,
      label: meta?.title || getContentTypeLabel(parsed.type),
      type: parsed.type,
      connections: degree.get(urn) ?? 0,
      color: getUrnTypeBrandStops(parsed.type).start,
    });
  }

  return { nodes, links };
}

export function getNodeSize(node: GraphNode): number {
  // Sqrt scale keeps hubs readable without letting them dwarf the rest of the graph.
  const baseSize = 4.5;
  const connectionBonus = Math.min(Math.sqrt(node.connections) * 2.4, 9);
  return baseSize + connectionBonus;
}
