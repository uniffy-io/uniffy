import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useTreeStateSync } from "@/features/notes/hooks/useTreeStateSync";
import {
  BookmarkSimple as BookmarkSimpleIcon,
  CaretDown,
  CaretRight,
  CaretUp,
  LockSimple,
  UsersThree,
  Buildings,
  ArrowsClockwise,
} from "@phosphor-icons/react";
import { useAppDispatch, useAppSelector } from "@/app/hooks";
import {
  setCurrentNote,
  createNote,
  fetchNote,
  deleteNote,
  updateNote,
  initializeNotesData,
  moveNote,
  copyNote,
} from "@/features/notes/store/notesSlice";
import {
  toggleNodeExpanded,
  expandNode,
  updateNodeTitle,
  expandAll,
  collapseAll,
  setBookmarkedNodes,
  setSelectedNode,
} from "@/features/notes/store/notesTreeSlice";
import type { TreeNode } from "@/features/notes/store/notesTreeSlice";
import { NodeType } from "@uniffy/proto/notes/v1/notes_pb";
import { AccessMode } from "@uniffy/proto/common/v1/common_pb";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useBookmarks } from "@/features/bookmarks";
import { cn } from "@/shared/utils/cn";
import { SidebarHeader } from "@/features/notes/components/sidebar/SidebarHeader";
import { TreeNodeItem } from "@/features/notes/components/sidebar/TreeNodeItem";
import { TreeNodeContextMenu } from "@/features/notes/components/sidebar/TreeNodeContextMenu";
import { TrashSection } from "@/features/notes/components/sidebar/TrashSection";
import { NoteMoveDialog } from "@/features/notes/components/sidebar/NoteMoveDialog";
import { CreateDropdown } from "@/features/notes/components/sidebar/CreateDropdown";
import { NotesSidebarSkeleton } from "@/features/notes/components/sidebar/NotesSidebarSkeleton";
import type { ActiveMenuState, MoveTarget } from "@/features/notes/components/sidebar/types";

interface SectionConfig {
  id: "bookmarked" | "personal" | "shared" | "organization" | "trash";
  name: string;
  icon: typeof LockSimple;
  scope?: number;
}

const SECTIONS: SectionConfig[] = [
  { id: "bookmarked", name: "Bookmarks", icon: BookmarkSimpleIcon },
  { id: "personal", name: "Personal Space", icon: LockSimple, scope: AccessMode.OWNER_ONLY },
  { id: "shared", name: "Shared With Me", icon: UsersThree },
  { id: "organization", name: "Organization", icon: Buildings, scope: AccessMode.OPEN_TO_ORG },
];

function findNodeRecursively(nodes: TreeNode[], nodeId: string): TreeNode | null {
  for (const node of nodes) {
    if (node.id === nodeId) return node;
    if (node.children) {
      const found = findNodeRecursively(node.children, nodeId);
      if (found) return found;
    }
  }
  return null;
}

function findNodeParentId(
  nodes: TreeNode[],
  nodeId: string,
  parentId: string | null = null,
): string | null {
  for (const node of nodes) {
    if (node.id === nodeId) return parentId;
    if (node.children) {
      const found = findNodeParentId(node.children, nodeId, node.id);
      if (found !== null) return found;
    }
  }
  return null;
}

export function NotesSidebar() {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();

  const currentNoteId = useAppSelector((state) => state.notes.currentNoteId);
  const organizationId = useAppSelector((state) => state.auth.currentOrganizationId);
  const tree = useAppSelector((state) => state.notesTree.tree);
  const expandedNodes = useAppSelector((state) => state.notesTree.expandedNodes);
  const selectedNodeId = useAppSelector((state) => state.notesTree.selectedNodeId);
  const loading = useAppSelector((state) => state.notesTree.loading);
  const treeLoaded = useAppSelector((state) => state.notesTree.treeLoaded);
  const creatingNote = useAppSelector((state) => state.notes.creatingNote);

  // Reveal the routed note in the tree (deep link / search result click):
  // expand its section and ancestor folders, expand the node itself when it
  // is a folder, and scroll it into view. Runs once per note id.
  const revealedNoteIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (!currentNoteId || !treeLoaded) return;
    if (revealedNoteIdRef.current === currentNoteId) return;

    const findPath = (nodes: TreeNode[], trail: TreeNode[]): TreeNode[] | null => {
      for (const node of nodes) {
        if (node.id === currentNoteId) return [...trail, node];
        if (node.children) {
          const found = findPath(node.children, [...trail, node]);
          if (found) return found;
        }
      }
      return null;
    };

    for (const section of ["personal", "shared", "organization"] as const) {
      const path = findPath(tree[section], []);
      if (!path) continue;
      revealedNoteIdRef.current = currentNoteId;
      dispatch(expandNode(section));
      for (const node of path) {
        if (node.type === "folder") {
          dispatch(expandNode(node.id));
        }
      }
      const timer = setTimeout(() => {
        document
          .querySelector(`[data-node-id="${currentNoteId}"]`)
          ?.scrollIntoView({ behavior: "smooth", block: "center" });
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [currentNoteId, treeLoaded, tree, dispatch]);

  useBookmarks();
  const bookmarkedUrns = useAppSelector((state) => state.bookmarks.bookmarkedUrns);

  useTreeStateSync();

  useEffect(() => {
    const bookmarkedNoteIds = Object.keys(bookmarkedUrns)
      .filter((urn) => bookmarkedUrns[urn] && urn.includes(":NOTE:"))
      .map((urn) => urn.split(":NOTE:")[1]);

    const findNodeById = (nodes: TreeNode[], id: string): TreeNode | null => {
      for (const node of nodes) {
        if (node.id === id) return node;
        if (node.children) {
          const found = findNodeById(node.children, id);
          if (found) return found;
        }
      }
      return null;
    };

    const allTreeNodes = [...tree.personal, ...tree.shared, ...tree.organization];

    const bookmarkedNodes: TreeNode[] = bookmarkedNoteIds
      .map((noteId) => findNodeById(allTreeNodes, noteId))
      .filter((node): node is TreeNode => node !== null);

    dispatch(setBookmarkedNodes(bookmarkedNodes));
  }, [bookmarkedUrns, tree.personal, tree.shared, tree.organization, dispatch]);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [draggedNodeId, setDraggedNodeId] = useState<string | null>(null);
  const [sectionDropTarget, setSectionDropTarget] = useState<string | null>(null);
  const [activeMenu, setActiveMenu] = useState<ActiveMenuState | null>(null);
  const [moveTarget, setMoveTarget] = useState<MoveTarget | null>(null);
  const [pendingOrgMove, setPendingOrgMove] = useState<{
    noteId: string;
    targetAccessMode: number;
    targetFolderId: string | null;
  } | null>(null);

  const isExpanded = useCallback((id: string) => expandedNodes.includes(id), [expandedNodes]);

  const findNodeVisibility = useCallback(
    (nodeId: string): number => {
      if (findNodeRecursively(tree.personal, nodeId)) return AccessMode.OWNER_ONLY;
      if (findNodeRecursively(tree.organization, nodeId)) return AccessMode.OPEN_TO_ORG;
      if (findNodeRecursively(tree.shared, nodeId)) return AccessMode.OWNER_ONLY;

      const inBookmarked = findNodeRecursively(tree.bookmarked, nodeId);
      if (inBookmarked) return inBookmarked.accessMode || AccessMode.OWNER_ONLY;

      return AccessMode.OWNER_ONLY;
    },
    [tree],
  );

  const handleToggle = useCallback(
    (id: string) => {
      dispatch(toggleNodeExpanded(id));
    },
    [dispatch],
  );

  const handleSelectNote = useCallback(
    async (noteId: string) => {
      dispatch(setSelectedNode(null));
      navigate(`/notes/${noteId}`);
      try {
        await dispatch(fetchNote(noteId)).unwrap();
      } catch {
        dispatch(setCurrentNote(null));
      }
    },
    [dispatch, navigate],
  );

  const handleNewNote = useCallback(
    async (accessMode: number = AccessMode.OWNER_ONLY) => {
      try {
        const result = await dispatch(
          createNote({
            title: "Untitled Note",
            content: "",
            accessMode,
            nodeType: NodeType.NOTE,
          }),
        ).unwrap();
        navigate(`/notes/${result.id}`);
        setEditingId(result.id);
      } catch {}
    },
    [dispatch, navigate],
  );

  const handleNewCanvas = useCallback(
    async (accessMode: number = AccessMode.OWNER_ONLY) => {
      try {
        const { createEmptyCanvas, serializeCanvas } =
          await import("@/features/notes/canvas/types");
        const result = await dispatch(
          createNote({
            title: "Untitled Canvas",
            content: serializeCanvas(createEmptyCanvas()),
            accessMode,
            nodeType: NodeType.CANVAS,
          }),
        ).unwrap();
        navigate(`/notes/${result.id}`);
        setEditingId(result.id);
      } catch {}
    },
    [dispatch, navigate],
  );

  const handleNewFolder = useCallback(
    async (accessMode: number = AccessMode.OWNER_ONLY, parentId?: string) => {
      try {
        const result = await dispatch(
          createNote({
            title: "New Folder",
            content: "",
            accessMode,
            nodeType: NodeType.FOLDER,
            parentId,
          }),
        ).unwrap();
        setEditingId(result.id);
      } catch {}
    },
    [dispatch],
  );

  const handleCreateSubfolder = useCallback(
    async (parentId: string) => {
      dispatch(expandNode(parentId));
      const accessMode = findNodeVisibility(parentId);
      await handleNewFolder(accessMode, parentId);
    },
    [dispatch, findNodeVisibility, handleNewFolder],
  );

  const handleCreateNoteInFolder = useCallback(
    async (parentId: string) => {
      dispatch(expandNode(parentId));
      const accessMode = findNodeVisibility(parentId);
      try {
        const result = await dispatch(
          createNote({
            title: "Untitled Note",
            content: "",
            accessMode,
            nodeType: NodeType.NOTE,
            parentId,
          }),
        ).unwrap();
        navigate(`/notes/${result.id}`);
        setEditingId(result.id);
      } catch {}
    },
    [dispatch, findNodeVisibility, navigate],
  );

  const handleCreateCanvasInFolder = useCallback(
    async (parentId: string) => {
      dispatch(expandNode(parentId));
      const accessMode = findNodeVisibility(parentId);
      try {
        const { createEmptyCanvas, serializeCanvas } =
          await import("@/features/notes/canvas/types");
        const result = await dispatch(
          createNote({
            title: "Untitled Canvas",
            content: serializeCanvas(createEmptyCanvas()),
            accessMode,
            nodeType: NodeType.CANVAS,
            parentId,
          }),
        ).unwrap();
        navigate(`/notes/${result.id}`);
        setEditingId(result.id);
      } catch {}
    },
    [dispatch, findNodeVisibility, navigate],
  );

  const handleRename = useCallback(
    async (nodeId: string, newTitle: string) => {
      if (!organizationId) return;
      dispatch(updateNodeTitle({ nodeId, title: newTitle }));
      try {
        await dispatch(updateNote({ noteId: nodeId, title: newTitle })).unwrap();
      } catch {
        dispatch(initializeNotesData({ forceRefresh: true }));
      }
    },
    [dispatch, organizationId],
  );

  const handleDelete = useCallback(
    async (noteId: string) => {
      try {
        await dispatch(deleteNote({ noteId })).unwrap();
        if (currentNoteId === noteId) {
          dispatch(setCurrentNote(null));
        }
      } catch {}
    },
    [dispatch, currentNoteId],
  );

  const handleCopy = useCallback(
    async (noteId: string) => {
      const visibility = findNodeVisibility(noteId);
      const allNodes = [...tree.personal, ...tree.shared, ...tree.organization, ...tree.bookmarked];
      const node = findNodeRecursively(allNodes, noteId);
      const title = node ? `Copy of ${node.title}` : "Copy";

      try {
        const result = await dispatch(
          copyNote({
            noteId,
            targetAccessMode: visibility,
            title,
          }),
        ).unwrap();
        dispatch(initializeNotesData({ forceRefresh: true }));
        navigate(`/notes/${result.id}`);
      } catch {}
    },
    [findNodeVisibility, tree, dispatch, navigate],
  );

  const handleOpenMoveDialog = useCallback(
    (nodeId: string) => {
      const visibility = findNodeVisibility(nodeId);
      const allNodes = [...tree.personal, ...tree.shared, ...tree.organization, ...tree.bookmarked];
      const node = findNodeRecursively(allNodes, nodeId);
      const parentId = findNodeParentId([...tree.personal, ...tree.organization], nodeId);

      setMoveTarget({
        noteId: nodeId,
        noteTitle: node?.title ?? "Note",
        currentAccessMode: visibility,
        currentParentId: parentId,
      });
    },
    [findNodeVisibility, tree],
  );

  const handleDrop = useCallback(
    async (targetFolderId: string, droppedNodeId: string) => {
      if (!organizationId) return;

      const droppedNodeVisibility = findNodeVisibility(droppedNodeId);
      const targetFolderVisibility = findNodeVisibility(targetFolderId);

      if (
        targetFolderVisibility === AccessMode.OPEN_TO_ORG &&
        droppedNodeVisibility !== AccessMode.OPEN_TO_ORG
      ) {
        setPendingOrgMove({
          noteId: droppedNodeId,
          targetAccessMode: targetFolderVisibility,
          targetFolderId,
        });
        return;
      }

      try {
        if (droppedNodeVisibility !== targetFolderVisibility) {
          await dispatch(
            moveNote({ noteId: droppedNodeId, targetAccessMode: targetFolderVisibility }),
          ).unwrap();
        }
        await dispatch(updateNote({ noteId: droppedNodeId, parentId: targetFolderId })).unwrap();
        dispatch(initializeNotesData({ forceRefresh: true }));
      } catch {
        dispatch(initializeNotesData({ forceRefresh: true }));
      }
    },
    [dispatch, organizationId, findNodeVisibility],
  );

  const handleDropOnSection = useCallback(
    async (targetAccessMode: number, droppedNodeId: string) => {
      if (!organizationId) return;

      const droppedNodeVisibility = findNodeVisibility(droppedNodeId);

      if (
        targetAccessMode === AccessMode.OPEN_TO_ORG &&
        droppedNodeVisibility !== AccessMode.OPEN_TO_ORG
      ) {
        setPendingOrgMove({ noteId: droppedNodeId, targetAccessMode, targetFolderId: null });
        return;
      }

      try {
        if (droppedNodeVisibility !== targetAccessMode) {
          await dispatch(moveNote({ noteId: droppedNodeId, targetAccessMode })).unwrap();
        }
        await dispatch(updateNote({ noteId: droppedNodeId, parentId: "" })).unwrap();
        dispatch(initializeNotesData({ forceRefresh: true }));
      } catch {
        dispatch(initializeNotesData({ forceRefresh: true }));
      }
    },
    [dispatch, organizationId, findNodeVisibility],
  );

  const handleOrgMoveConfirm = useCallback(async () => {
    if (!pendingOrgMove || !organizationId) return;
    const { noteId, targetAccessMode, targetFolderId } = pendingOrgMove;

    try {
      await dispatch(moveNote({ noteId, targetAccessMode })).unwrap();
      await dispatch(updateNote({ noteId, parentId: targetFolderId ?? "" })).unwrap();
      dispatch(initializeNotesData({ forceRefresh: true }));
    } catch {
      dispatch(initializeNotesData({ forceRefresh: true }));
    } finally {
      setPendingOrgMove(null);
    }
  }, [pendingOrgMove, organizationId, dispatch]);

  const handleOpenMenu = useCallback(
    (
      nodeId: string,
      nodeType: "note" | "folder" | "canvas",
      position: { x: number; y: number },
    ) => {
      setActiveMenu({ nodeId, nodeType, position });
    },
    [],
  );

  const handleCloseMenu = useCallback(() => {
    setActiveMenu(null);
  }, []);

  const handleMenuRename = useCallback((nodeId: string) => {
    setEditingId(nodeId);
  }, []);

  const handleMenuMove = useCallback(
    (nodeId: string) => {
      handleOpenMoveDialog(nodeId);
    },
    [handleOpenMoveDialog],
  );

  const treeActions = useMemo(
    () => ({
      onToggle: handleToggle,
      onSelect: handleSelectNote,
      onRename: handleRename,
      onDelete: handleDelete,
    }),
    [handleToggle, handleSelectNote, handleRename, handleDelete],
  );

  const treeDrag = useMemo(
    () => ({
      draggedNodeId,
      onDrop: handleDrop,
      onDragStart: (nodeId: string) => setDraggedNodeId(nodeId),
      onDragEnd: () => setDraggedNodeId(null),
    }),
    [draggedNodeId, handleDrop],
  );

  const treeEditing = useMemo(
    () => ({
      editingId,
      onStartEdit: setEditingId,
      onCancelEdit: () => setEditingId(null),
    }),
    [editingId],
  );

  const isNodeSelected = useCallback(
    (nodeId: string) => currentNoteId === nodeId || selectedNodeId === nodeId,
    [currentNoteId, selectedNodeId],
  );

  const handleRefresh = useCallback(() => {
    dispatch(initializeNotesData({ forceRefresh: true }));
  }, [dispatch]);

  const renderSection = (config: SectionConfig) => {
    const nodes = tree[config.id];
    const sectionExpanded = isExpanded(config.id);
    const SectionIcon = config.icon;
    const canDropOnSection = config.scope && draggedNodeId;
    const isDropTarget = sectionDropTarget === config.id;

    return (
      <div key={config.id}>
        <div
          onClick={() => handleToggle(config.id)}
          onDragOver={(e) => {
            if (canDropOnSection) {
              e.preventDefault();
              setSectionDropTarget(config.id);
            }
          }}
          onDragLeave={() => setSectionDropTarget(null)}
          onDrop={(e) => {
            e.preventDefault();
            setSectionDropTarget(null);
            if (canDropOnSection && draggedNodeId && config.scope) {
              handleDropOnSection(config.scope, draggedNodeId);
            }
          }}
          className={cn(
            "w-full flex items-center gap-2 px-2 py-2 text-sm rounded-md hover:bg-accent transition-colors text-left group cursor-pointer",
            isDropTarget && "bg-primary/10 ring-2 ring-primary",
          )}
        >
          {sectionExpanded ? (
            <CaretDown size={16} weight="bold" className="text-muted-foreground" />
          ) : (
            <CaretRight size={16} weight="bold" className="text-muted-foreground" />
          )}
          <SectionIcon
            size={16}
            weight="duotone"
            className={config.id === "bookmarked" ? "text-primary" : "text-muted-foreground"}
          />
          <span className="flex-1">{config.name}</span>
          {config.scope && (
            <span className="opacity-0 group-hover:opacity-100 transition-all shrink-0 flex items-center">
              <CreateDropdown
                compact
                onCreateNote={() => handleNewNote(config.scope)}
                onCreateCanvas={() => handleNewCanvas(config.scope)}
                onCreateFolder={() => handleNewFolder(config.scope)}
              />
            </span>
          )}
        </div>

        {sectionExpanded && nodes.length > 0 && (
          <div className="ml-4 pl-2 border-l border-border space-y-0.5 mt-0.5">
            {nodes.map((node) => (
              <TreeNodeItem
                key={node.id}
                node={node}
                isExpanded={isExpanded(node.id)}
                isSelected={currentNoteId === node.id}
                actions={treeActions}
                drag={treeDrag}
                editing={treeEditing}
                isNodeExpanded={isExpanded}
                isNodeSelected={isNodeSelected}
                onOpenMenu={handleOpenMenu}
                onCreateNote={handleCreateNoteInFolder}
                onCreateCanvas={handleCreateCanvasInFolder}
                onCreateFolder={handleCreateSubfolder}
              />
            ))}
          </div>
        )}

        {sectionExpanded && nodes.length === 0 && (
          <div className="ml-8 py-2 text-xs text-muted-foreground">No notes yet</div>
        )}
      </div>
    );
  };

  return (
    <div className="flex flex-col h-full">
      <SidebarHeader
        onCreateNote={() => handleNewNote()}
        onCreateCanvas={() => handleNewCanvas()}
        onCreateFolder={() => handleNewFolder()}
        creatingNote={creatingNote}
      />

      <div className="flex-1 overflow-y-auto px-3 py-2">
        <nav className="space-y-0.5">
          <div className="flex items-center gap-0.5 mb-1">
            <button
              onClick={() => dispatch(expandAll())}
              className="p-1 rounded-md bg-transparent hover:bg-muted transition-colors"
              title="Expand all"
            >
              <CaretDown size={14} weight="bold" className="text-muted-foreground" />
            </button>
            <button
              onClick={() => dispatch(collapseAll())}
              className="p-1 rounded-md bg-transparent hover:bg-muted transition-colors"
              title="Collapse all"
            >
              <CaretUp size={14} weight="bold" className="text-muted-foreground" />
            </button>
            <button
              onClick={handleRefresh}
              disabled={loading}
              className="p-1 rounded-md bg-transparent hover:bg-muted transition-colors disabled:opacity-50"
              title="Refresh"
            >
              <ArrowsClockwise
                size={14}
                weight="bold"
                className={`text-muted-foreground ${loading ? "animate-spin" : ""}`}
              />
            </button>
          </div>
          {loading &&
          tree.personal.length === 0 &&
          tree.organization.length === 0 &&
          tree.shared.length === 0 &&
          tree.bookmarked.length === 0 ? (
            <NotesSidebarSkeleton />
          ) : (
            <>{SECTIONS.map(renderSection)}</>
          )}
          <TrashSection
            trashNodes={tree.trash}
            currentNoteId={currentNoteId}
            organizationId={organizationId}
            onSelectNote={handleSelectNote}
          />
        </nav>
      </div>

      <ConfirmDialog
        isOpen={pendingOrgMove !== null}
        onClose={() => setPendingOrgMove(null)}
        onConfirm={handleOrgMoveConfirm}
        title="Move to Organization"
        message="Moving this note to Organization will make it visible to all organization members. Any content referenced within (attached files, mentioned notes, inline media) will also become visible to the organization."
        confirmLabel="Move to Organization"
        cancelLabel="Cancel"
        variant="warning"
      />

      {activeMenu && (
        <TreeNodeContextMenu
          menu={activeMenu}
          onClose={handleCloseMenu}
          onRename={handleMenuRename}
          onDelete={handleDelete}
          onCopy={handleCopy}
          onMove={handleMenuMove}
        />
      )}

      {moveTarget && <NoteMoveDialog target={moveTarget} onClose={() => setMoveTarget(null)} />}
    </div>
  );
}
