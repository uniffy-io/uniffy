/**
 * Notes Graph Utilities
 *
 * Utilities for building graph data from notes based on URN mentions.
 * Used by the NotesGraphDashboard to visualize note connections.
 */

import { NodeType } from '@uniffy/proto/notes/v1/notes_pb';
import type { UrnMetadata } from '@uniffy/proto/search/v1/search_pb';
import { parseUrn, UrnType } from '@/shared/utils/urn';
import type { SerializedNote } from '@/features/notes/store/notesThunks';
import { URN_TYPE_HEX_COLORS } from '@/config/theme/urnColors';
import { getContentTypeLabel } from '@/config/theme/contentTypes';

/** Custom icon for a note */
export interface NoteIconData {
  type: 'icon' | 'emoji';
  value: string;
}

/** Node in the graph representing a note or external resource */
export interface GraphNode {
  /** Unique identifier (note ID or URN for external resources) */
  id: string;
  /** Display label */
  label: string;
  /** Type of the node */
  type: UrnType | 'note';
  /** Full URN if available */
  urn?: string;
  /** Whether this is an internal note vs external reference */
  isInternal: boolean;
  /** Number of connections (for sizing) */
  connections: number;
  /** Color based on type */
  color: string;
  /** Custom icon (heroicon or emoji) for internal notes */
  customIcon?: NoteIconData;
  /** @deprecated Use customIcon.type === 'emoji' instead */
  emoji?: string;
  /** X position (set by force simulation) */
  x?: number;
  /** Y position (set by force simulation) */
  y?: number;
  /** X velocity (set by force simulation) */
  vx?: number;
  /** Y velocity (set by force simulation) */
  vy?: number;
}

/** Link between two nodes */
export interface GraphLink {
  /** Source node ID */
  source: string;
  /** Target node ID */
  target: string;
  /** Label for the link (optional) */
  label?: string;
}

/** Complete graph data structure */
export interface GraphData {
  nodes: GraphNode[];
  links: GraphLink[];
}

/** Parse mentions from markdown content using [[[label|urn]]] pattern */
export function parseMentionsFromContent(content: string): Array<{ label: string; urn: string }> {
  const mentionRegex = /\[\[\[([^\]|]+)\|([^\]]+)\]\]\]/g;
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

/** Get color for a node based on its type */
function getNodeColor(type: UrnType | 'note', isInternal: boolean): string {
  // Internal notes use a special marker that will be resolved at render time
  if (isInternal) {
    return '__PRIMARY__';
  }

  return URN_TYPE_HEX_COLORS[type as UrnType] || URN_TYPE_HEX_COLORS[UrnType.UNKNOWN];
}

/**
 * Build graph data from a collection of notes.
 * Creates nodes for each note and links based on outgoingReferences.
 *
 * @param notes - Array of notes to build the graph from
 * @param urnMetadata - Optional map of URN -> metadata for resolving external node labels
 */
export function buildGraphData(
  notes: SerializedNote[],
  urnMetadata?: Map<string, Omit<UrnMetadata, '$typeName'>>
): GraphData {
  const nodes: GraphNode[] = [];
  const links: GraphLink[] = [];
  const nodeMap = new Map<string, GraphNode>();
  const connectionCount = new Map<string, number>();

  // Filter out folder notes - they're organizational containers, not content nodes
  const contentNotes = notes.filter((note) => note.nodeType !== NodeType.FOLDER);

  // Build a map of note IDs to titles for label lookup
  const noteTitles = new Map<string, string>();
  for (const note of contentNotes) {
    noteTitles.set(note.id, note.title || 'Untitled');
  }

  // First pass: count connections for sizing using outgoingReferences
  for (const note of contentNotes) {
    const refs = note.outgoingReferences || [];
    connectionCount.set(note.id, (connectionCount.get(note.id) || 0) + refs.length);

    // Count incoming connections for referenced items
    for (const urn of refs) {
      const parsed = parseUrn(urn);
      if (parsed.isValid) {
        connectionCount.set(parsed.id, (connectionCount.get(parsed.id) || 0) + 1);
      }
    }
  }

  // Second pass: create nodes for all content notes
  for (const note of contentNotes) {
    const noteUrn = `urn:uniffy:content:NOTE:${note.id}`;

    // Extract custom icon if the note has one
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
      // Keep emoji for backwards compatibility
      emoji: customIcon?.type === 'emoji' ? customIcon.value : undefined,
    };

    nodes.push(node);
    nodeMap.set(note.id, node);
  }

  // Third pass: create links and external nodes from outgoingReferences
  for (const note of contentNotes) {
    const refs = note.outgoingReferences || [];

    for (const urn of refs) {
      const parsed = parseUrn(urn);
      if (!parsed.isValid) continue;

      // Check if target is an internal note
      const isInternalNote = nodeMap.has(parsed.id);

      if (!isInternalNote && !nodeMap.has(parsed.id)) {
        // Create external node
        // Priority for label: resolved metadata > note title (if note) > type label
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

      // Create link
      links.push({
        source: note.id,
        target: parsed.id,
      });
    }
  }

  // WORKAROUND: Add invisible self-links for nodes that are only targets
  // This fixes a bug in react-force-graph-2d where target-only nodes don't get hit detection
  const sourceNodeIds = new Set(links.map(l => l.source));
  for (const node of nodes) {
    if (!sourceNodeIds.has(node.id)) {
      // Add a self-referencing link with zero visual impact
      links.push({
        source: node.id,
        target: node.id,
      });
    }
  }

  return { nodes, links };
}

/** Get a human-readable label for a URN type using centralized config */
function getTypeLabel(type: UrnType): string {
  return getContentTypeLabel(type);
}

/**
 * Calculate node size based on connection count.
 * More connections = larger node.
 */
export function getNodeSize(node: GraphNode): number {
  const baseSize = 6;
  const connectionBonus = Math.min(node.connections * 1.5, 10);
  return baseSize + connectionBonus;
}

/**
 * Get statistics about the graph.
 */
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
