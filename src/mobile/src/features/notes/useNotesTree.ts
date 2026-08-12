import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { formatRelativeSeconds } from "@shared/lib/dateFormatting";
import { useAuth } from "@core/providers/AuthContext";
import { notesApi } from "@features/notes/notesApi";
import { noteToPlain, stripMarkdown, bucketForNote } from "@features/notes/noteSerializer";
import type { SerializedNote } from "@features/notes/noteSerializer";
import { NodeType } from "@uniffy/proto/notes/v1/notes_pb";

export interface TreeNode {
  id: string;
  title: string;
  type: "note" | "folder";
  /** Canvas boards are notes structurally, but their body is board JSON, so no
   * surface may open them in the markdown editor. */
  isCanvas: boolean;
  icon?: { type: string; value: string };
  children?: TreeNode[];
  parentId?: string;
  accessMode: number;
  updatedAt?: { seconds: number; nanos: number };
  ownerInfo?: { id: string; name: string; email: string };
  isShared?: boolean;
  // Card data (notes only)
  snippet?: string;
  editedAt?: string;
  tags?: string[];
  refCount?: number;
}

export interface TreeSection {
  id: string;
  label: string;
  nodes: TreeNode[];
}

function noteToTreeNode(note: SerializedNote): TreeNode {
  const isFolder = note.nodeType === NodeType.FOLDER;
  const isCanvas = note.nodeType === NodeType.CANVAS;
  return {
    id: note.id,
    title: note.title,
    type: isFolder ? "folder" : "note",
    isCanvas,
    icon: note.icon,
    parentId: note.parentId,
    accessMode: note.accessMode,
    updatedAt: note.updatedAt,
    ownerInfo: note.ownerInfo,
    isShared: note.sharedWith != null && note.sharedWith.length > 0,
    snippet: isFolder || isCanvas ? undefined : stripMarkdown(note.content || "").slice(0, 120),
    editedAt: note.updatedAt ? formatRelativeSeconds(note.updatedAt.seconds) : "just now",
    tags: note.tags.length > 0 ? note.tags.map((t) => t.name) : undefined,
    refCount: isFolder ? undefined : note.outgoingReferences.length,
  };
}

function sortNodes(nodes: TreeNode[]): TreeNode[] {
  return nodes.sort((a, b) => {
    if (a.type === "folder" && b.type !== "folder") return -1;
    if (a.type !== "folder" && b.type === "folder") return 1;
    return a.title.localeCompare(b.title, undefined, { sensitivity: "base" });
  });
}

function buildHierarchy(notes: SerializedNote[]): TreeNode[] {
  const nodeMap = new Map<string, TreeNode>();
  const roots: TreeNode[] = [];

  for (const note of notes) {
    nodeMap.set(note.id, noteToTreeNode(note));
  }

  for (const note of notes) {
    const node = nodeMap.get(note.id)!;
    if (note.parentId && nodeMap.has(note.parentId)) {
      const parent = nodeMap.get(note.parentId)!;
      if (!parent.children) parent.children = [];
      parent.children.push(node);
    } else {
      roots.push(node);
    }
  }

  sortNodes(roots);
  const sortChildren = (node: TreeNode) => {
    if (node.children?.length) {
      sortNodes(node.children);
      node.children.forEach(sortChildren);
    }
  };
  roots.forEach(sortChildren);
  return roots;
}

function organizeSections(notes: SerializedNote[], userId: string): TreeSection[] {
  const personal: SerializedNote[] = [];
  const shared: SerializedNote[] = [];
  const organization: SerializedNote[] = [];

  for (const note of notes) {
    if (note.isDeleted) continue;

    switch (bucketForNote(note.accessMode, note.ownerId, userId)) {
      case "organization":
        organization.push(note);
        break;
      case "shared":
        shared.push(note);
        break;
      default:
        personal.push(note);
    }
  }

  const sections: TreeSection[] = [];

  sections.push({
    id: "personal",
    label: "Personal Space",
    nodes: buildHierarchy(personal),
  });

  if (shared.length > 0) {
    sections.push({
      id: "shared",
      label: "Shared With Me",
      nodes: buildHierarchy(shared),
    });
  }

  if (organization.length > 0) {
    sections.push({
      id: "organization",
      label: "Organization",
      nodes: buildHierarchy(organization),
    });
  }

  return sections;
}

export type Breadcrumb = { id: string; title: string };

function findTrail(nodes: TreeNode[], targetId: string, trail: Breadcrumb[]): Breadcrumb[] | null {
  for (const node of nodes) {
    const next = [...trail, { id: node.id, title: node.title || "Untitled" }];
    if (node.id === targetId) return next;
    if (node.children?.length) {
      const found = findTrail(node.children, targetId, next);
      if (found) return found;
    }
  }
  return null;
}

// Ancestor folders of a note, nearest-root first, excluding the note itself.
// Empty when the note sits at a section root or the tree has not loaded.
export function useNoteBreadcrumb(noteId: string | undefined): Breadcrumb[] {
  const { data } = useNotesTree();

  return useMemo(() => {
    if (!noteId || !data) return [];
    for (const section of data) {
      const trail = findTrail(section.nodes, noteId, []);
      if (trail) return trail.slice(0, -1);
    }
    return [];
  }, [data, noteId]);
}

export function useNotesTree() {
  const { organizationId, user } = useAuth();
  const userId = user?.id;

  return useQuery({
    queryKey: ["notes-tree", organizationId],
    queryFn: async () => {
      const response = await notesApi.listNotes({
        organizationId: organizationId!,
        pageSize: 500,
        sortBy: "title",
        sortOrder: "asc",
      });
      const notes = response.notes.map((n) => noteToPlain(n));
      return organizeSections(notes, userId!);
    },
    enabled: !!organizationId && !!userId,
  });
}
