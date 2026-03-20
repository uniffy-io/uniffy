import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/context/auth-context";
import { notesApi } from "@/api/notesApi";
import { noteToPlain, formatRelativeTime, stripMarkdown } from "@/lib/noteSerializer";
import type { SerializedNote } from "@/lib/noteSerializer";
import { VisibilityScope, NodeType } from "@uniffy/proto/notes/v1/notes_pb";

export interface TreeNode {
  id: string;
  title: string;
  type: "note" | "folder";
  icon?: { type: string; value: string };
  children?: TreeNode[];
  parentId?: string;
  visibility: number;
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
  return {
    id: note.id,
    title: note.title,
    type: isFolder ? "folder" : "note",
    icon: note.icon,
    parentId: note.parentId,
    visibility: note.visibility,
    updatedAt: note.updatedAt,
    ownerInfo: note.ownerInfo,
    isShared: note.sharedWith != null && note.sharedWith.length > 0,
    snippet: isFolder ? undefined : stripMarkdown(note.content || "").slice(0, 120),
    editedAt: note.updatedAt ? formatRelativeTime(note.updatedAt.seconds) : "just now",
    tags: note.tags.length > 0 ? note.tags : undefined,
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

    switch (note.visibility) {
      case VisibilityScope.PRIVATE:
        if (note.ownerId === userId) {
          personal.push(note);
        } else {
          shared.push(note);
        }
        break;
      case VisibilityScope.GROUP:
        if (note.ownerId === userId) {
          organization.push(note);
        } else {
          shared.push(note);
        }
        break;
      case VisibilityScope.ORGANIZATION:
        organization.push(note);
        break;
      default:
        if (note.ownerId === userId) {
          personal.push(note);
        }
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
