import { NodeType } from '@uniffy/proto/notes/v1/notes_pb';
import type { UrnMetadata } from '@uniffy/proto/search/v1/search_pb';
import { parseUrn, UrnType } from '@/shared/utils/urn';
import type { SerializedNote } from '@/features/notes/store/notesThunks';
import { URN_TYPE_HEX_COLORS } from '@/config/theme/urnColors';
import { getContentTypeLabel } from '@/config/theme/contentTypes';

export interface NoteIconData {
  type: 'icon' | 'emoji';
  value: string;
}

export interface GraphNode {
  id: string;
  label: string;
  type: UrnType | 'note';
  urn?: string;
  isInternal: boolean;
  connections: number;
  color: string;
  customIcon?: NoteIconData;
  emoji?: string;
  x?: number;
  y?: number;
  vx?: number;
  vy?: number;
}

export interface GraphLink {
  source: string;
  target: string;
  label?: string;
}

export interface GraphData {
  nodes: GraphNode[];
  links: GraphLink[];
}

/** Parse [[[label|urn]]] mentions from markdown. */
export function parseMentionsFromContent(content: string): Array<{ label: string; urn: string }> {
  const mentionRegex = /\[\[\[([^[\]|]+)\|([^\]]+)\]\]\]/g;
  const mentions: Array<{ label: string; urn: string }> = [];
  const seenUrns = new Set<string>();

  let match;
  while ((match = mentionRegex.exec(content)) !== null) {
    const [, label, urn] = match;
    if (!seenUrns.has(urn)) {
      seenUrns.add(urn);
      mentions.push({ label, urn });
    }
  }

  return mentions;
}

function getNodeColor(type: UrnType | 'note', isInternal: boolean): string {
  // Internal notes use a marker resolved at render time.
  if (isInternal) {
    return '__PRIMARY__';
  }
  return URN_TYPE_HEX_COLORS[type as UrnType] || URN_TYPE_HEX_COLORS[UrnType.UNKNOWN];
}

export function buildGraphData(
  notes: SerializedNote[],
  urnMetadata?: Map<string, Omit<UrnMetadata, '$typeName'>>
): GraphData {
  const nodes: GraphNode[] = [];
  const links: GraphLink[] = [];
  const nodeMap = new Map<string, GraphNode>();
  const connectionCount = new Map<string, number>();

  // Folder notes are organizational containers, not content nodes.
  const contentNotes = notes.filter((note) => note.nodeType !== NodeType.FOLDER);

  const noteTitles = new Map<string, string>();
  for (const note of contentNotes) {
    noteTitles.set(note.id, note.title || 'Untitled');
  }

  for (const note of contentNotes) {
    const refs = note.outgoingReferences || [];
    connectionCount.set(note.id, (connectionCount.get(note.id) || 0) + refs.length);

    for (const urn of refs) {
      const parsed = parseUrn(urn);
      if (parsed.isValid) {
        connectionCount.set(parsed.id, (connectionCount.get(parsed.id) || 0) + 1);
      }
    }
  }

  for (const note of contentNotes) {
    const noteUrn = `urn:uniffy:content:NOTE:${note.id}`;

    const customIcon: NoteIconData | undefined = note.icon
      ? { type: note.icon.type, value: note.icon.value }
      : undefined;

    const node: GraphNode = {
      id: note.id,
      label: note.title || 'Untitled',
      type: 'note',
      urn: noteUrn,
      isInternal: true,
      connections: connectionCount.get(note.id) || 0,
      color: getNodeColor('note', true),
      customIcon,
      emoji: customIcon?.type === 'emoji' ? customIcon.value : undefined,
    };

    nodes.push(node);
    nodeMap.set(note.id, node);
  }

  for (const note of contentNotes) {
    const refs = note.outgoingReferences || [];

    for (const urn of refs) {
      const parsed = parseUrn(urn);
      if (!parsed.isValid) continue;

      const isInternalNote = nodeMap.has(parsed.id);

      if (!isInternalNote && !nodeMap.has(parsed.id)) {
        // Label priority: resolved metadata > note title > type label.
        let label: string;
        const resolvedMeta = urnMetadata?.get(urn);
        if (resolvedMeta?.title) {
          label = resolvedMeta.title;
        } else if (parsed.type === UrnType.NOTE) {
          label = noteTitles.get(parsed.id) || 'Note';
        } else {
          label = getTypeLabel(parsed.type);
        }

        const externalNode: GraphNode = {
          id: parsed.id,
          label,
          type: parsed.type,
          urn,
          isInternal: false,
          connections: connectionCount.get(parsed.id) || 0,
          color: getNodeColor(parsed.type, false),
        };
        nodes.push(externalNode);
        nodeMap.set(parsed.id, externalNode);
      }

      links.push({
        source: note.id,
        target: parsed.id,
      });
    }
  }

  // Workaround: react-force-graph-2d hit detection fails on target-only nodes; add invisible self-links.
  const sourceNodeIds = new Set(links.map(l => l.source));
  for (const node of nodes) {
    if (!sourceNodeIds.has(node.id)) {
      links.push({
        source: node.id,
        target: node.id,
      });
    }
  }

  return { nodes, links };
}

function getTypeLabel(type: UrnType): string {
  return getContentTypeLabel(type);
}

export function getNodeSize(node: GraphNode): number {
  const baseSize = 6;
  const connectionBonus = Math.min(node.connections * 1.5, 10);
  return baseSize + connectionBonus;
}

export function getGraphStats(data: GraphData): {
  totalNodes: number;
  internalNotes: number;
  externalReferences: number;
  totalLinks: number;
  avgConnections: number;
} {
  const internalNotes = data.nodes.filter(n => n.isInternal).length;
  const externalReferences = data.nodes.filter(n => !n.isInternal).length;
  const totalConnections = data.nodes.reduce((sum, n) => sum + n.connections, 0);

  return {
    totalNodes: data.nodes.length,
    internalNotes,
    externalReferences,
    totalLinks: data.links.length,
    avgConnections: data.nodes.length > 0 ? totalConnections / data.nodes.length : 0,
  };
}
