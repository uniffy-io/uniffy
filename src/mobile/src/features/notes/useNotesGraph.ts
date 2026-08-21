import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@core/providers/AuthContext";
import { notesApi } from "@features/notes/notesApi";
import { noteToPlain } from "@features/notes/noteSerializer";
import { NodeType } from "@uniffy/proto/notes/v1/notes_pb";

export interface GraphNode {
  id: string;
  label: string;
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

const NOTE_COLOR = "#8b5cf6";

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

// Notes and the links between them, and nothing else. A note that mentions a
// file or a meeting is pointing outside this graph, so that reference is not a
// node here - it used to be, which filled the view with "File" and
// "Calendar_event" blobs that connect to one note each and say nothing about
// how the writing hangs together.
function buildGraph(rawNotes: ReturnType<typeof noteToPlain>[]): NotesGraphData {
  const contentNotes = rawNotes.filter((n) => n.nodeType !== NodeType.FOLDER && !n.isDeleted);
  const noteIds = new Set(contentNotes.map((n) => n.id));

  const connectionCount = new Map<string, number>();
  const links: GraphLink[] = [];

  for (const note of contentNotes) {
    for (const urn of note.outgoingReferences) {
      const parsed = parseUrn(urn);
      if (!parsed || parsed.type !== "NOTE") continue;
      if (parsed.id === note.id || !noteIds.has(parsed.id)) continue;
      links.push({ source: note.id, target: parsed.id });
      connectionCount.set(note.id, (connectionCount.get(note.id) ?? 0) + 1);
      connectionCount.set(parsed.id, (connectionCount.get(parsed.id) ?? 0) + 1);
    }
  }

  const nodes: GraphNode[] = contentNotes.map((note, i) => {
    const pos = spiralPos(i);
    return {
      id: note.id,
      label: note.title || "Untitled",
      connections: connectionCount.get(note.id) ?? 0,
      color: NOTE_COLOR,
      x: pos.x,
      y: pos.y,
    };
  });

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
