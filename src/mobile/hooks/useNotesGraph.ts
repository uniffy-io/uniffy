import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/context/auth-context";
import { notesApi } from "@/api/notesApi";
import { noteToPlain } from "@/lib/noteSerializer";
import { NodeType } from "@/gen/notes/v1/notes_pb";

export interface GraphNode {
  id: string;
  label: string;
  isNote: boolean;
  connections: number;
  color: string;
  x: number;
  y: number;
}

export interface SimNode extends GraphNode {
  vx: number;
  vy: number;
}

export interface GraphLink {
  source: string;
  target: string;
}

export interface NotesGraphData {
  nodes: GraphNode[];
  links: GraphLink[];
}

const NOTE_COLOR = "#7C5CFC";

const URN_TYPE_COLORS: Record<string, string> = {
  NOTE: NOTE_COLOR,
  FILE: "#3b82f6",
  CHAT: "#8b5cf6",
  USER: "#10b981",
  CALENDAR_EVENT: "#f43f5e",
};

function parseUrn(urn: string): { type: string; id: string } | null {
  const m = urn.match(/^urn:uniffy:content:(\w+):([a-f0-9-]+)$/);
  if (!m) return null;
  return { type: m[1], id: m[2] };
}

function spiralPos(index: number): { x: number; y: number } {
  const goldenAngle = Math.PI * (3 - Math.sqrt(5));
  const angle = index * goldenAngle;
  const radius = Math.sqrt(index + 1) * 6;
  return { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius };
}

function buildGraph(rawNotes: ReturnType<typeof noteToPlain>[]): NotesGraphData {
  const contentNotes = rawNotes.filter((n) => n.nodeType !== NodeType.FOLDER && !n.isDeleted);

  const connectionCount = new Map<string, number>();

  for (const note of contentNotes) {
    for (const urn of note.outgoingReferences) {
      const parsed = parseUrn(urn);
      if (!parsed) continue;
      connectionCount.set(note.id, (connectionCount.get(note.id) ?? 0) + 1);
      connectionCount.set(parsed.id, (connectionCount.get(parsed.id) ?? 0) + 1);
    }
  }

  const nodes: GraphNode[] = [];
  const links: GraphLink[] = [];
  const seenIds = new Set<string>();

  for (let i = 0; i < contentNotes.length; i++) {
    const note = contentNotes[i];
    const pos = spiralPos(i);
    nodes.push({
      id: note.id,
      label: note.title || "Untitled",
      isNote: true,
      connections: connectionCount.get(note.id) ?? 0,
      color: NOTE_COLOR,
      x: pos.x,
      y: pos.y,
    });
    seenIds.add(note.id);
  }

  for (const note of contentNotes) {
    for (const urn of note.outgoingReferences) {
      const parsed = parseUrn(urn);
      if (!parsed) continue;

      if (!seenIds.has(parsed.id)) {
        const pos = spiralPos(nodes.length);
        const color = URN_TYPE_COLORS[parsed.type] ?? "#909296";
        nodes.push({
          id: parsed.id,
          label: parsed.type.charAt(0) + parsed.type.slice(1).toLowerCase(),
          isNote: false,
          connections: connectionCount.get(parsed.id) ?? 0,
          color,
          x: pos.x,
          y: pos.y,
        });
        seenIds.add(parsed.id);
      }

      links.push({ source: note.id, target: parsed.id });
    }
  }

  return { nodes, links };
}

export function useNotesGraph() {
  const { organizationId, user } = useAuth();

  return useQuery({
    queryKey: ["notes-graph", organizationId],
    queryFn: async () => {
      const response = await notesApi.listNotes({
        organizationId: organizationId!,
        pageSize: 500,
        sortBy: "title",
        sortOrder: "asc",
      });
      return buildGraph(response.notes.map((n) => noteToPlain(n)));
    },
    enabled: !!organizationId && !!user,
    staleTime: 60_000,
  });
}
