/**
 * Notes Graph Utilities
 *
 * Utilities for building graph data from notes based on URN mentions.
 * Used by the NotesGraphDashboard to visualize note connections.
 */

import type { Note } from '@/gen/notes/v1/notes_pb';
import type { PlainMessage } from '@bufbuild/protobuf';
import { parseUrn, UrnType } from '@/utils/urn';
import { URN_TYPE_HEX_COLORS } from '@/theme/urnColors';

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
  /** Whether the note is pinned */
  isPinned?: boolean;
  /** Color based on type */
  color: string;
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
 */
export function buildGraphData(notes: PlainMessage<Note>[]): GraphData {
  const nodes: GraphNode[] = [];
  const links: GraphLink[] = [];
  const nodeMap = new Map<string, GraphNode>();
  const connectionCount = new Map<string, number>();

  // Build a map of note IDs to titles for label lookup
  const noteTitles = new Map<string, string>();
  for (const note of notes) {
    noteTitles.set(note.id, note.title || 'Untitled');
  }

  // First pass: count connections for sizing using outgoingReferences
  for (const note of notes) {
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

  // Second pass: create nodes for all notes
  for (const note of notes) {
    const noteUrn = `urn:uwos:content:NOTE:${note.id}`;

    const node: GraphNode = {
      id: note.id,
      label: note.title || 'Untitled',
      type: 'note',
      urn: noteUrn,
      isInternal: true,
      connections: connectionCount.get(note.id) || 0,
      isPinned: note.isPinned,
      color: getNodeColor('note', true),
    };

    nodes.push(node);
    nodeMap.set(note.id, node);
  }

  // Third pass: create links and external nodes from outgoingReferences
  for (const note of notes) {
    const refs = note.outgoingReferences || [];

    for (const urn of refs) {
      const parsed = parseUrn(urn);
      if (!parsed.isValid) continue;

      // Check if target is an internal note
      const isInternalNote = nodeMap.has(parsed.id);

      if (!isInternalNote && !nodeMap.has(parsed.id)) {
        // Create external node - use note title if it's a note, otherwise use type label
        const label = parsed.type === UrnType.NOTE
          ? noteTitles.get(parsed.id) || 'Note'
          : getTypeLabel(parsed.type);

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

  return { nodes, links };
}

/** Get a human-readable label for a URN type */
function getTypeLabel(type: UrnType): string {
  const labels: Record<UrnType, string> = {
    [UrnType.NOTE]: 'Note',
    [UrnType.FILE]: 'File',
    [UrnType.CHAT]: 'Chat',
    [UrnType.USER]: 'User',
    [UrnType.BOOK]: 'Book',
    [UrnType.CALENDAR_EVENT]: 'Event',
    [UrnType.PASSWORD]: 'Password',
    [UrnType.SPACE]: 'Space',
    [UrnType.UNKNOWN]: 'Unknown',
  };
  return labels[type] || 'Unknown';
}

/**
 * Calculate node size based on connection count.
 * More connections = larger node.
 */
export function getNodeSize(node: GraphNode): number {
  const baseSize = 8;
  const connectionBonus = Math.min(node.connections * 2, 16);
  const pinnedBonus = node.isPinned ? 4 : 0;
  return baseSize + connectionBonus + pinnedBonus;
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
