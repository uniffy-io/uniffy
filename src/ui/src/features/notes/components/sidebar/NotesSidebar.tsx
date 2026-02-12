/**
 * Notes Sidebar Component
 *
 * Displays the notes tree organized by visibility scope.
 * Supports creating, renaming, and navigating notes.
 */

import { useState, useRef, useEffect, useCallback } from 'react';
import { useNavigate, useLocation, Link } from 'react-router-dom';
import { useTreeStateSync } from '@/features/notes/hooks/useTreeStateSync';
import {
  Plus,
  BookmarkSimpleIcon,
  CaretDown,
  CaretRight,
  CaretUp,
  FileText,
  CaretDoubleLeft,
  Folder,
  FolderPlusIcon,
  LockSimple,
  UsersThree,
  Buildings,
  Trash,
  PencilSimple,
  ArrowsClockwise,
  ArrowUUpLeft,
  Atom,
  Tag,
} from '@phosphor-icons/react';
import type { Icon } from '@phosphor-icons/react';
import { useAppDispatch, useAppSelector } from '@/app/hooks';
import { setCurrentNote, createNote, fetchNote, deleteNote, updateNote, restoreNote, initializeNotesData, moveNote } from '@/features/notes/store/notesSlice';
import { toggleSidebar } from '@/features/notes/store/editorSlice';
import {
  toggleNodeExpanded,
  updateNodeTitle,
  expandAll,
  collapseAll,
  setBookmarkedNodes,
  setSelectedNode,
  type TreeNode,
} from '@/features/notes/store/notesTreeSlice';
import { VisibilityScope, NodeType } from '@/gen/notes/v1/notes_pb';
import { notesApi } from '@/features/notes/api/notesApi';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { useBookmarks, useIsBookmarked } from '@/features/bookmarks';
import { cn } from '@/shared/utils/cn';
import { renderNoteIcon } from '@/features/notes/utils/noteIcons';

// Section configuration
interface SectionConfig {
  id: 'bookmarked' | 'personal' | 'shared' | 'organization' | 'trash';
  name: string;
  icon: typeof Folder;
  scope?: VisibilityScope;
}

const SECTIONS: SectionConfig[] = [
  { id: 'bookmarked', name: 'Bookmarks', icon: BookmarkSimpleIcon },
  { id: 'personal', name: 'Personal Space', icon: LockSimple, scope: VisibilityScope.PRIVATE },
  { id: 'shared', name: 'Shared With Me', icon: UsersThree },
  { id: 'organization', name: 'Organization', icon: Buildings, scope: VisibilityScope.ORGANIZATION },
];

// Notes submenu navigation items
interface NotesNavItem {
  name: string;
  path: string;
  icon: Icon;
}

const notesNavItems: NotesNavItem[] = [
  { name: 'Graph', path: '/notes/graph', icon: Atom },
  { name: 'Tags', path: '/notes/tags', icon: Tag },
];

/**
 * Compact nav item that expands on hover to show label.
 * Matches the style of AppHeader's navigation items.
 */
function CompactNavItem({ item, isActive }: { item: NotesNavItem; isActive: boolean }) {
  const IconComponent = item.icon;

  return (
    <Link
      to={item.path}
      className={cn(
        "group relative flex items-center py-1.5 px-1.5 text-sm font-medium rounded-lg transition-all duration-700 ease-out overflow-hidden",
        "hover:px-2.5",
        isActive && "text-foreground"
      )}
    >
      {/* Active indicator */}
      <span
        className={cn(
          "absolute inset-0 rounded-lg transition-all duration-500",
          isActive ? "bg-primary/10" : "bg-transparent"
        )}
      />

      {/* Hover underline effect */}
      <span className="absolute bottom-0 left-1/2 -translate-x-1/2 h-0.5 rounded-full bg-primary transition-all duration-700 ease-out w-0 opacity-0 group-hover:w-1/2 group-hover:opacity-70" />

      {/* Icon */}
      <span className={cn(
        "relative z-10 flex items-center justify-center w-7 h-7 rounded-md transition-all duration-500 ease-out",
        isActive
          ? "bg-primary text-primary-foreground"
          : "text-muted-foreground group-hover:text-primary"
      )}>
        <IconComponent size={18} weight={isActive ? "fill" : "duotone"} />
      </span>

      {/* Label - hidden by default, shows on hover */}
      <span className={cn(
        "relative z-10 ml-0 max-w-0 overflow-hidden whitespace-nowrap transition-all duration-700 ease-out",
        "group-hover:ml-1.5 group-hover:max-w-24",
        isActive ? "text-foreground" : "text-muted-foreground group-hover:text-foreground"
      )}>
        {item.name}
      </span>
    </Link>
  );
}

/**
 * Notes submenu navigation component.
 * Displays view options like Knowledge Graph and Tags.
 */
function NotesSubmenu() {
  const location = useLocation();

  return (
    <div className="px-3 py-2 border-b border-border">
      <nav className="flex items-center gap-0.5">
        {notesNavItems.map((item) => {
          // Exact match for specific routes
          const isActive = location.pathname === item.path;

          return (
            <CompactNavItem key={item.path} item={item} isActive={isActive} />
          );
        })}
      </nav>
    </div>
  );
}

/**
 * Tree node component - renders a single node and its children recursively.
 */
function TreeNodeItem({
  node,
  depth = 0,
  isExpanded,
  isSelected,
  onToggle,
  onSelect,
  onRename,
  onDelete,
  onCreateSubfolder,
  onCreateNoteInFolder,
  editingId,
  onStartEdit,
  onCancelEdit,
  onDrop,
  draggedNodeId,
  onDragStart,
  onDragEnd,
  isNodeExpanded,
  isNodeSelected,
}: {
  node: TreeNode;
  depth?: number;
  isExpanded: boolean;
  isSelected: boolean;
  onToggle: (id: string) => void;
  onSelect: (id: string) => void;
  onRename: (id: string, title: string) => void;
  onDelete: (id: string) => void;
  onCreateSubfolder: (parentId: string) => void;
  onCreateNoteInFolder: (parentId: string) => void;
  editingId: string | null;
  onStartEdit: (id: string) => void;
  onCancelEdit: () => void;
  onDrop: (targetNodeId: string, droppedNodeId: string) => void;
  draggedNodeId: string | null;
  onDragStart: (nodeId: string) => void;
  onDragEnd: () => void;
  isNodeExpanded: (nodeId: string) => boolean;
  isNodeSelected: (nodeId: string) => boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  // Start with node.title, user edits update this
  const [editValue, setEditValue] = useState(node.title);
  const [isDragOver, setIsDragOver] = useState(false);
  const isFolder = node.type === 'folder';
  const hasChildren = isFolder && node.children && node.children.length > 0;
  const isEditing = editingId === node.id;
  const isDragging = draggedNodeId === node.id;

  // Check if this note is bookmarked (via URN) - must be called unconditionally
  const noteUrn = node.noteId ? `urn:uniffy:content:NOTE:${node.noteId}` : '';
  const isBookmarked = useIsBookmarked(noteUrn);

  // Check if draggedNodeId is a descendant of this node (prevent dropping into own children)
  const isDescendant = (nodeToCheck: TreeNode, targetId: string): boolean => {
    if (nodeToCheck.id === targetId) return true;
    if (!nodeToCheck.children) return false;
    return nodeToCheck.children.some(child => isDescendant(child, targetId));
  };

  // Can only drop here if:
  // 1. This is a folder
  // 2. Not dropping onto itself
  // 3. Not dropping into its own descendant (would create circular reference)
  const canDropHere = isFolder && draggedNodeId !== node.id && (!draggedNodeId || !isDescendant(node, draggedNodeId));

  // Focus input when editing starts (useEffect is needed for DOM focus)
  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
      // Reset edit value to current title when starting edit
      setEditValue(node.title);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally only run when isEditing changes
  }, [isEditing]);

  const handleSubmitRename = () => {
    if (editValue.trim() && editValue !== node.title) {
      onRename(node.id, editValue.trim());
    }
    onCancelEdit();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSubmitRename();
    } else if (e.key === 'Escape') {
      setEditValue(node.title);
      onCancelEdit();
    }
  };

  if (isFolder) {
    return (
      <div data-node-id={node.id}>
        <div
          draggable={!isEditing}
          onDragStart={(e) => {
            e.stopPropagation();
            onDragStart(node.id);
          }}
          onDragEnd={onDragEnd}
          className={`w-full flex items-center gap-2 px-2 py-1.5 text-sm rounded-md hover:bg-accent transition-colors text-left group ${
            isDragOver ? 'bg-primary/10 ring-2 ring-primary' : ''
          } ${isDragging ? 'opacity-50' : ''} ${isSelected ? 'bg-accent ring-2 ring-primary/50' : ''}`}
          onDragOver={(e) => {
            if (canDropHere) {
              e.preventDefault();
              setIsDragOver(true);
            }
          }}
          onDragLeave={() => setIsDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setIsDragOver(false);
            if (canDropHere && draggedNodeId) {
              onDrop(node.id, draggedNodeId);
            }
          }}
        >
          <button onClick={() => onToggle(node.id)} className="flex items-center">
            {isExpanded ? (
              <CaretDown size={14} weight="bold" className="text-muted-foreground" />
            ) : (
              <CaretRight size={14} weight="bold" className="text-muted-foreground" />
            )}
          </button>
          <Folder size={16} weight="duotone" className="text-muted-foreground flex-shrink-0" />
          {isEditing ? (
            <input
              ref={inputRef}
              type="text"
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              onBlur={handleSubmitRename}
              onKeyDown={handleKeyDown}
              className="flex-1 bg-background border border-input rounded px-1 py-0.5 text-sm outline-none focus:ring-1 focus:ring-ring"
            />
          ) : (
            <span
              className="flex-1 truncate cursor-pointer"
              onDoubleClick={() => onStartEdit(node.id)}
            >
              {node.title}
            </span>
          )}
          <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-all">
            <span
              onClick={(e) => {
                e.stopPropagation();
                onCreateNoteInFolder(node.id);
              }}
              className="p-0.5 rounded hover:bg-muted cursor-pointer"
              title="New note inside"
            >
              <Plus size={14} weight="bold" className="text-muted-foreground" />
            </span>
            <span
              onClick={(e) => {
                e.stopPropagation();
                onCreateSubfolder(node.id);
              }}
              className="p-0.5 rounded hover:bg-muted cursor-pointer"
              title="New folder inside"
            >
              <FolderPlusIcon size={14} weight="duotone" className="text-muted-foreground" />
            </span>
            <span
              onClick={(e) => {
                e.stopPropagation();
                onStartEdit(node.id);
              }}
              className="p-0.5 rounded hover:bg-muted cursor-pointer"
              title="Rename"
            >
              <PencilSimple size={14} weight="duotone" className="text-muted-foreground" />
            </span>
            <span
              onClick={(e) => {
                e.stopPropagation();
                onDelete(node.id);
              }}
              className="p-0.5 rounded hover:bg-destructive/10 cursor-pointer"
              title="Delete"
            >
              <Trash size={14} weight="duotone" className="text-destructive" />
            </span>
          </div>
        </div>
        {isExpanded && hasChildren && (
          <div className="ml-3 pl-2 border-l border-border space-y-0.5 mt-0.5">
            {node.children!.map((child) => (
              <TreeNodeItem
                key={child.id}
                node={child}
                depth={depth + 1}
                isExpanded={isNodeExpanded(child.id)}
                isSelected={isNodeSelected(child.id)}
                onToggle={onToggle}
                onSelect={onSelect}
                onRename={onRename}
                onDelete={onDelete}
                onCreateSubfolder={onCreateSubfolder}
                onCreateNoteInFolder={onCreateNoteInFolder}
                editingId={editingId}
                onStartEdit={onStartEdit}
                onCancelEdit={onCancelEdit}
                onDrop={onDrop}
                draggedNodeId={draggedNodeId}
                onDragStart={onDragStart}
                onDragEnd={onDragEnd}
                isNodeExpanded={isNodeExpanded}
                isNodeSelected={isNodeSelected}
              />
            ))}
          </div>
        )}
      </div>
    );
  }

  // Note item
  return (
    <div
      data-node-id={node.id}
      draggable={!isEditing}
      onDragStart={(e) => {
        e.stopPropagation();
        onDragStart(node.id);
      }}
      onDragEnd={onDragEnd}
      className={`w-full flex items-center gap-2 px-2 py-1.5 text-sm rounded-md hover:bg-accent transition-colors text-left group cursor-pointer ${
        isSelected ? 'bg-accent text-accent-foreground' : ''
      } ${isDragging ? 'opacity-50' : ''}`}
      onClick={() => onSelect(node.id)}
    >
      {node.type === 'folder' ? (
        <Folder size={16} weight="duotone" className="text-muted-foreground flex-shrink-0" />
      ) : (
        renderNoteIcon(node.icon, "h-4 w-4 text-muted-foreground flex-shrink-0")
      )}
      {isBookmarked && (
        <BookmarkSimpleIcon size={12} weight="fill" className="text-primary flex-shrink-0" />
      )}
      {isEditing ? (
        <input
          ref={inputRef}
          type="text"
          value={editValue}
          onChange={(e) => setEditValue(e.target.value)}
          onBlur={handleSubmitRename}
          onKeyDown={handleKeyDown}
          onClick={(e) => e.stopPropagation()}
          className="flex-1 bg-background border border-input rounded px-1 py-0.5 text-sm outline-none focus:ring-1 focus:ring-ring"
        />
      ) : (
        <span
          className="flex-1 truncate"
          onDoubleClick={(e) => {
            e.stopPropagation();
            onStartEdit(node.id);
          }}
        >
          {node.title}
        </span>
      )}
      <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-all">
        <span
          onClick={(e) => {
            e.stopPropagation();
            onStartEdit(node.id);
          }}
          className="p-0.5 rounded hover:bg-muted cursor-pointer"
          title="Rename"
        >
          <PencilSimple size={14} weight="duotone" className="text-muted-foreground" />
        </span>
        <span
          onClick={(e) => {
            e.stopPropagation();
            onDelete(node.id);
          }}
          className="p-0.5 rounded hover:bg-destructive/10 cursor-pointer"
          title="Delete"
        >
          <Trash size={14} weight="duotone" className="text-destructive" />
        </span>
      </div>
    </div>
  );
}

/**
 * Main sidebar component.
 */
export function NotesSidebar() {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();

  // Redux state
  const currentNoteId = useAppSelector((state) => state.notes.currentNoteId);
  const organizationId = useAppSelector((state) => state.auth.currentOrganizationId);
  const tree = useAppSelector((state) => state.notesTree.tree);
  const expandedNodes = useAppSelector((state) => state.notesTree.expandedNodes);
  const selectedNodeId = useAppSelector((state) => state.notesTree.selectedNodeId);
  const loading = useAppSelector((state) => state.notesTree.loading);
  const error = useAppSelector((state) => state.notesTree.error);
  const creatingNote = useAppSelector((state) => state.notes.creatingNote);
  // Bookmarks state - useBookmarks() auto-fetches when organization changes
  useBookmarks();
  const bookmarkedUrns = useAppSelector((state) => state.bookmarks.bookmarkedUrns);

  // Sync tree expanded state with localStorage for persistence
  useTreeStateSync();

  // Populate bookmarked section from bookmarks store
  // Use tree data instead of notes slice since tree is always populated after fetchNotesTree
  useEffect(() => {
    // Find all notes whose URNs are bookmarked
    const bookmarkedNoteIds = Object.keys(bookmarkedUrns)
      .filter(urn => bookmarkedUrns[urn] && urn.includes(':NOTE:'))
      .map(urn => urn.split(':NOTE:')[1]);

    // Helper to find a node by ID in any tree section
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

    // Search all tree sections (personal, shared, organization, groups) for bookmarked nodes
    const allTreeNodes = [
      ...tree.personal,
      ...tree.shared,
      ...tree.organization,
      ...tree.groups.flatMap(g => g.nodes),
    ];

    // Build tree nodes for bookmarked notes by finding them in the existing tree
    const bookmarkedNodes: TreeNode[] = bookmarkedNoteIds
      .map(noteId => findNodeById(allTreeNodes, noteId))
      .filter((node): node is TreeNode => node !== null);

    dispatch(setBookmarkedNodes(bookmarkedNodes));
  }, [bookmarkedUrns, tree.personal, tree.shared, tree.organization, tree.groups, dispatch]);

  // Local UI state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showTrash, setShowTrash] = useState(false);
  const [emptyingTrash, setEmptyingTrash] = useState(false);
  const [showEmptyTrashConfirm, setShowEmptyTrashConfirm] = useState(false);
  const [restoringNoteId, setRestoringNoteId] = useState<string | null>(null);
  const [draggedNodeId, setDraggedNodeId] = useState<string | null>(null);
  const [pendingOrgMove, setPendingOrgMove] = useState<{
    noteId: string;
    targetVisibility: VisibilityScope;
    targetFolderId: string | null;
  } | null>(null);

  // Check if a node is expanded
  const isExpanded = useCallback(
    (id: string) => expandedNodes.includes(id),
    [expandedNodes]
  );

  // Toggle node expansion
  const handleToggle = useCallback(
    (id: string) => {
      dispatch(toggleNodeExpanded(id));
    },
    [dispatch]
  );

  // Select a note
  const handleSelectNote = useCallback(
    async (noteId: string) => {
      // Clear any breadcrumb-selected folder highlight
      dispatch(setSelectedNode(null));

      // Navigate to the note URL (this will also trigger setCurrentNote via useEffect in NotesPage)
      navigate(`/notes/${noteId}`);

      // Fetch full note content to ensure we have complete data
      // The loading state will be shown while fetching
      try {
        await dispatch(fetchNote(noteId)).unwrap();
      } catch (err) {
        console.error('Failed to fetch note:', err);
        // On error, clear current note to show error state
        dispatch(setCurrentNote(null));
      }
    },
    [dispatch, navigate]
  );

  // Create a new note
  const handleNewNote = useCallback(
    async (visibility: VisibilityScope = VisibilityScope.PRIVATE) => {
      try {
        const result = await dispatch(
          createNote({
            title: 'Untitled Note',
            content: '# Untitled Note\n\nStart writing here...',
            visibility,
            nodeType: NodeType.NOTE,
          })
        ).unwrap();

        // Navigate to the new note immediately
        navigate(`/notes/${result.id}`);

        // Tree is updated automatically via createNote.fulfilled reducer
        // Start editing the title immediately
        setEditingId(result.id);
      } catch (err) {
        console.error('Failed to create note:', err);
      }
    },
    [dispatch, navigate]
  );

  // Create a new folder
  const handleNewFolder = useCallback(
    async (visibility: VisibilityScope = VisibilityScope.PRIVATE, parentId?: string) => {
      try {
        const result = await dispatch(
          createNote({
            title: 'New Folder',
            content: '',
            visibility,
            nodeType: NodeType.FOLDER,
            parentId,
          })
        ).unwrap();

        // Tree is updated automatically via createNote.fulfilled reducer
        // Start editing the title immediately
        setEditingId(result.id);
      } catch (err) {
        console.error('Failed to create folder:', err);
      }
    },
    [dispatch]
  );

  // Helper to recursively find a node in the tree by ID
  const findNodeRecursively = useCallback(
    (nodes: TreeNode[], nodeId: string): TreeNode | null => {
      for (const node of nodes) {
        if (node.id === nodeId) return node;
        if (node.children) {
          const found = findNodeRecursively(node.children, nodeId);
          if (found) return found;
        }
      }
      return null;
    },
    []
  );

  // Helper to find a node's visibility by searching all tree sections
  const findNodeVisibility = useCallback(
    (nodeId: string): VisibilityScope => {
      // Check each section with its known visibility
      // Personal section = PRIVATE
      const inPersonal = findNodeRecursively(tree.personal, nodeId);
      if (inPersonal) return VisibilityScope.PRIVATE;

      // Organization section = ORGANIZATION
      const inOrg = findNodeRecursively(tree.organization, nodeId);
      if (inOrg) return VisibilityScope.ORGANIZATION;

      // Shared section = PRIVATE (shared with us, but our creations default to private)
      const inShared = findNodeRecursively(tree.shared, nodeId);
      if (inShared) return VisibilityScope.PRIVATE;

      // Groups = GROUP visibility
      for (const group of tree.groups) {
        const inGroup = findNodeRecursively(group.nodes, nodeId);
        if (inGroup) return VisibilityScope.GROUP;
      }

      // Bookmarked - check the node's actual visibility or default to PRIVATE
      const inBookmarked = findNodeRecursively(tree.bookmarked, nodeId);
      if (inBookmarked) return inBookmarked.visibility || VisibilityScope.PRIVATE;

      // Default to PRIVATE
      return VisibilityScope.PRIVATE;
    },
    [tree, findNodeRecursively]
  );

  // Create subfolder inside a parent folder
  const handleCreateSubfolder = useCallback(
    async (parentId: string) => {
      const visibility = findNodeVisibility(parentId);
      await handleNewFolder(visibility, parentId);
    },
    [findNodeVisibility, handleNewFolder]
  );

  // Create note inside a parent folder
  const handleCreateNoteInFolder = useCallback(
    async (parentId: string) => {
      const visibility = findNodeVisibility(parentId);

      try {
        const result = await dispatch(
          createNote({
            title: 'Untitled Note',
            content: '# Untitled Note\n\nStart writing here...',
            visibility,
            nodeType: NodeType.NOTE,
            parentId,
          })
        ).unwrap();

        // Navigate to the new note immediately
        navigate(`/notes/${result.id}`);

        // Tree is updated automatically via createNote.fulfilled reducer
        // Start editing the title immediately
        setEditingId(result.id);
      } catch (err) {
        console.error('Failed to create note:', err);
      }
    },
    [findNodeVisibility, dispatch, navigate]
  );

  // Rename a note/folder
  const handleRename = useCallback(
    async (nodeId: string, newTitle: string) => {
      if (!organizationId) return;

      // Update tree UI immediately for instant feedback
      dispatch(updateNodeTitle({ nodeId, title: newTitle }));

      try {
        // Update via thunk (which updates both API and notes state)
        await dispatch(updateNote({
          noteId: nodeId,
          title: newTitle,
        })).unwrap();
      } catch (err) {
        console.error('Failed to rename note/folder:', err);
        // Force refresh to revert to server state on error
        dispatch(initializeNotesData({ forceRefresh: true }));
      }
    },
    [dispatch, organizationId]
  );

  // Handle drop - move note into folder (and optionally change visibility)
  const handleDrop = useCallback(
    async (targetFolderId: string, droppedNodeId: string) => {
      if (!organizationId) return;

      const droppedNodeVisibility = findNodeVisibility(droppedNodeId);
      const targetFolderVisibility = findNodeVisibility(targetFolderId);

      // Confirm before moving to organization scope
      if (targetFolderVisibility === VisibilityScope.ORGANIZATION &&
          droppedNodeVisibility !== VisibilityScope.ORGANIZATION) {
        setPendingOrgMove({
          noteId: droppedNodeId,
          targetVisibility: targetFolderVisibility,
          targetFolderId,
        });
        return;
      }

      try {
        if (droppedNodeVisibility !== targetFolderVisibility) {
          await dispatch(moveNote({
            noteId: droppedNodeId,
            targetVisibility: targetFolderVisibility,
          })).unwrap();
        }

        await dispatch(updateNote({
          noteId: droppedNodeId,
          parentId: targetFolderId,
        })).unwrap();

        dispatch(initializeNotesData({ forceRefresh: true }));
      } catch (err) {
        console.error('Failed to move note:', err);
        dispatch(initializeNotesData({ forceRefresh: true }));
      }
    },
    [dispatch, organizationId, findNodeVisibility]
  );

  // Drag handlers
  const handleDragStart = useCallback((nodeId: string) => {
    setDraggedNodeId(nodeId);
  }, []);

  const handleDragEnd = useCallback(() => {
    setDraggedNodeId(null);
  }, []);

  // Delete a note or folder (moves to trash)
  const handleDelete = useCallback(
    async (noteId: string) => {
      try {
        await dispatch(deleteNote({ noteId })).unwrap();

        // If we deleted the currently selected note, clear selection
        if (currentNoteId === noteId) {
          dispatch(setCurrentNote(null));
        }

        // Tree is updated automatically via deleteNote.fulfilled reducer
      } catch (err) {
        console.error('Failed to delete item:', err);
      }
    },
    [dispatch, currentNoteId]
  );

  // Refresh tree (force fetch from API, bypass cache)
  const handleRefresh = useCallback(() => {
    dispatch(initializeNotesData({ forceRefresh: true }));
  }, [dispatch]);

  // Handle drop on section header - moves note to root of that section with new visibility
  const handleDropOnSection = useCallback(
    async (targetVisibility: VisibilityScope, droppedNodeId: string) => {
      if (!organizationId) return;

      const droppedNodeVisibility = findNodeVisibility(droppedNodeId);

      // Confirm before moving to organization scope
      if (targetVisibility === VisibilityScope.ORGANIZATION &&
          droppedNodeVisibility !== VisibilityScope.ORGANIZATION) {
        setPendingOrgMove({
          noteId: droppedNodeId,
          targetVisibility,
          targetFolderId: null,
        });
        return;
      }

      try {
        if (droppedNodeVisibility !== targetVisibility) {
          await dispatch(moveNote({
            noteId: droppedNodeId,
            targetVisibility: targetVisibility,
          })).unwrap();
        }

        await dispatch(updateNote({
          noteId: droppedNodeId,
          parentId: '',
        })).unwrap();

        dispatch(initializeNotesData({ forceRefresh: true }));
      } catch (err) {
        console.error('Failed to move note to section:', err);
        dispatch(initializeNotesData({ forceRefresh: true }));
      }
    },
    [dispatch, organizationId, findNodeVisibility]
  );

  // Execute pending organization move after user confirmation
  const handleOrgMoveConfirm = useCallback(async () => {
    if (!pendingOrgMove || !organizationId) return;

    const { noteId, targetVisibility, targetFolderId } = pendingOrgMove;

    try {
      await dispatch(moveNote({
        noteId,
        targetVisibility,
      })).unwrap();

      await dispatch(updateNote({
        noteId,
        parentId: targetFolderId ?? '',
      })).unwrap();

      dispatch(initializeNotesData({ forceRefresh: true }));
    } catch (err) {
      console.error('Failed to move note:', err);
      dispatch(initializeNotesData({ forceRefresh: true }));
    } finally {
      setPendingOrgMove(null);
    }
  }, [pendingOrgMove, organizationId, dispatch]);

  // Track section drop state
  const [sectionDropTarget, setSectionDropTarget] = useState<string | null>(null);

  // Render a section
  const renderSection = (config: SectionConfig) => {
    const nodes = tree[config.id];
    const sectionExpanded = isExpanded(config.id);
    const IconComponent = config.icon;

    // Use BookmarkIconSolid for bookmarked section
    const SectionIcon = config.id === 'bookmarked' ?
      (sectionExpanded ? BookmarkSimpleIcon : BookmarkSimpleIcon) :
      IconComponent;

    // Can drop on sections with a defined scope (personal, organization)
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
            isDropTarget && "bg-primary/10 ring-2 ring-primary"
          )}
        >
          {sectionExpanded ? (
            <CaretDown size={16} weight="bold" className="text-muted-foreground" />
          ) : (
            <CaretRight size={16} weight="bold" className="text-muted-foreground" />
          )}
          <SectionIcon size={16} weight="duotone" className={`${config.id === 'bookmarked' ? 'text-primary' : 'text-muted-foreground'}`} />
          <span className="flex-1">{config.name}</span>
          {config.scope && (
            <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-all">
              <span
                onClick={(e) => {
                  e.stopPropagation();
                  handleNewFolder(config.scope);
                }}
                className="p-0.5 rounded hover:bg-muted cursor-pointer"
                title="New folder"
              >
                <FolderPlusIcon size={14} weight="duotone" className="text-muted-foreground" />
              </span>
              <span
                onClick={(e) => {
                  e.stopPropagation();
                  handleNewNote(config.scope);
                }}
                className="p-0.5 rounded hover:bg-muted cursor-pointer"
                title="New note"
              >
                <Plus size={14} weight="bold" className="text-muted-foreground" />
              </span>
            </div>
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
                onToggle={handleToggle}
                onSelect={handleSelectNote}
                onRename={handleRename}
                onDelete={handleDelete}
                onCreateSubfolder={handleCreateSubfolder}
                onCreateNoteInFolder={handleCreateNoteInFolder}
                editingId={editingId}
                onStartEdit={setEditingId}
                onCancelEdit={() => setEditingId(null)}
                onDrop={handleDrop}
                draggedNodeId={draggedNodeId}
                onDragStart={handleDragStart}
                onDragEnd={handleDragEnd}
                isNodeExpanded={isExpanded}
                isNodeSelected={(nodeId) => currentNoteId === nodeId || selectedNodeId === nodeId}
              />
            ))}
          </div>
        )}

        {sectionExpanded && nodes.length === 0 && (
          <div className="ml-8 py-2 text-xs text-muted-foreground">
            No notes yet
          </div>
        )}
      </div>
    );
  };

  // Render group sections
  const renderGroups = () => {
    if (tree.groups.length === 0) return null;

    return (
      <div className="mt-2 pt-2 border-t border-border">
        <p className="px-2 py-1 text-xs font-medium text-muted-foreground uppercase tracking-wider">
          Groups
        </p>
        {tree.groups.map((group) => {
          const groupExpanded = isExpanded(`group-${group.groupId}`);

          return (
            <div key={group.groupId}>
              <button
                onClick={() => handleToggle(`group-${group.groupId}`)}
                className="w-full flex items-center gap-2 px-2 py-2 text-sm rounded-md hover:bg-accent transition-colors text-left group"
              >
                {groupExpanded ? (
                  <CaretDown size={16} weight="bold" className="text-muted-foreground" />
                ) : (
                  <CaretRight size={16} weight="bold" className="text-muted-foreground" />
                )}
                <UsersThree size={16} weight="duotone" className="text-muted-foreground" />
                <span className="flex-1">{group.groupName}</span>
              </button>

              {groupExpanded && group.nodes.length > 0 && (
                <div className="ml-4 pl-2 border-l border-border space-y-0.5 mt-0.5">
                  {group.nodes.map((node) => (
                    <TreeNodeItem
                      key={node.id}
                      node={node}
                      isExpanded={isExpanded(node.id)}
                      isSelected={currentNoteId === node.id}
                      onToggle={handleToggle}
                      onSelect={handleSelectNote}
                      onRename={handleRename}
                      onDelete={handleDelete}
                      onCreateSubfolder={handleCreateSubfolder}
                      onCreateNoteInFolder={handleCreateNoteInFolder}
                      editingId={editingId}
                      onStartEdit={setEditingId}
                      onCancelEdit={() => setEditingId(null)}
                      onDrop={handleDrop}
                      draggedNodeId={draggedNodeId}
                      onDragStart={handleDragStart}
                      onDragEnd={handleDragEnd}
                      isNodeExpanded={isExpanded}
                      isNodeSelected={(nodeId) => currentNoteId === nodeId || selectedNodeId === nodeId}
                    />
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    );
  };

  // Show empty trash confirmation modal
  const handleEmptyTrashClick = useCallback(() => {
    if (tree.trash.length === 0 || !organizationId) return;
    setShowEmptyTrashConfirm(true);
  }, [tree.trash.length, organizationId]);

  // Handle confirmed empty trash
  const handleEmptyTrashConfirm = useCallback(async () => {
    if (!organizationId) return;

    try {
      setEmptyingTrash(true);
      await notesApi.emptyTrash({ organizationId });

      // If current note was in trash, clear selection
      if (currentNoteId && tree.trash.some((n) => n.id === currentNoteId)) {
        dispatch(setCurrentNote(null));
      }

      // Force refresh to get updated state after bulk delete
      dispatch(initializeNotesData({ forceRefresh: true }));
    } catch (error) {
      console.error('Failed to empty trash:', error);
    } finally {
      setEmptyingTrash(false);
      setShowEmptyTrashConfirm(false);
    }
  }, [organizationId, dispatch, currentNoteId, tree.trash]);

  // Handle restoring a note from trash
  const handleRestore = useCallback(async (noteId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      setRestoringNoteId(noteId);
      await dispatch(restoreNote(noteId)).unwrap();
      // Tree is updated automatically via restoreNote.fulfilled reducer
    } catch (error) {
      console.error('Failed to restore note:', error);
    } finally {
      setRestoringNoteId(null);
    }
  }, [dispatch]);

  // Render trash section
  const renderTrash = () => {
    if (tree.trash.length === 0) return null;

    return (
      <div className="mt-2 pt-2 border-t border-border">
        <div className="flex items-center gap-1">
          <button
            onClick={() => setShowTrash(!showTrash)}
            className="flex-1 flex items-center gap-2 px-2 py-2 text-sm rounded-md hover:bg-accent transition-colors text-left"
          >
            {showTrash ? (
              <CaretDown size={16} weight="bold" className="text-muted-foreground" />
            ) : (
              <CaretRight size={16} weight="bold" className="text-muted-foreground" />
            )}
            <Trash size={16} weight="duotone" className="text-muted-foreground" />
            <span className="flex-1">Trash</span>
          </button>
          <button
            onClick={handleEmptyTrashClick}
            disabled={emptyingTrash || tree.trash.length === 0}
            className="px-2 py-1.5 text-xs rounded-md hover:bg-destructive/10 hover:text-destructive transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            title="Empty trash"
          >
            {emptyingTrash ? 'Emptying...' : 'Empty'}
          </button>
        </div>

        {showTrash && (
          <div className="ml-4 pl-2 border-l border-border space-y-0.5 mt-0.5">
            {tree.trash.map((node) => (
              <div
                key={node.id}
                onClick={() => handleSelectNote(node.id)}
                className={`group w-full flex items-center gap-2 px-2 py-1.5 text-sm rounded-md hover:bg-accent transition-colors text-left opacity-60 cursor-pointer ${currentNoteId === node.id ? 'bg-accent text-accent-foreground' : ''
                  }`}
              >
                <FileText size={16} weight="duotone" className="text-muted-foreground flex-shrink-0" />
                <span className="truncate flex-1">{node.title}</span>
                <button
                  onClick={(e) => handleRestore(node.id, e)}
                  disabled={restoringNoteId === node.id}
                  className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-primary/10 hover:text-primary transition-all disabled:opacity-50"
                  title="Restore"
                >
                  {restoringNoteId === node.id ? (
                    <ArrowsClockwise size={14} weight="bold" className="animate-spin" />
                  ) : (
                    <ArrowUUpLeft size={14} weight="bold" />
                  )}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-3 pt-3 pb-2">
        <button
          onClick={() => handleNewNote()}
          disabled={creatingNote}
          className="flex items-center gap-2 px-3 py-1.5 text-sm text-primary bg-transparent hover:bg-muted rounded-md transition-colors disabled:opacity-50"
        >
          {creatingNote ? (
            <ArrowsClockwise size={16} weight="bold" className="animate-spin" />
          ) : (
            <Plus size={16} weight="bold" />
          )}
          <span>New Note</span>
        </button>
        <div className="flex items-center gap-1">
          <button
            onClick={() => dispatch(expandAll())}
            className="p-1.5 rounded-md bg-transparent hover:bg-muted transition-colors"
            title="Expand all"
          >
            <CaretDown size={16} weight="bold" className="text-muted-foreground" />
          </button>
          <button
            onClick={() => dispatch(collapseAll())}
            className="p-1.5 rounded-md bg-transparent hover:bg-muted transition-colors"
            title="Collapse all"
          >
            <CaretUp size={16} weight="bold" className="text-muted-foreground" />
          </button>
          <button
            onClick={handleRefresh}
            disabled={loading}
            className="p-1.5 rounded-md bg-transparent hover:bg-muted transition-colors disabled:opacity-50"
            title="Refresh"
          >
            <ArrowsClockwise size={16} weight="bold" className={`text-muted-foreground ${loading ? 'animate-spin' : ''}`} />
          </button>
          <button
            onClick={() => dispatch(toggleSidebar())}
            className="p-1.5 rounded-md bg-transparent hover:bg-muted transition-colors"
            title="Toggle sidebar (⌘\\)"
          >
            <CaretDoubleLeft size={16} weight="bold" className="text-primary" />
          </button>
        </div>
      </div>

      {/* Notes Submenu */}
      <NotesSubmenu />

      {/* Error state */}
      {error && (
        <div className="px-3 py-2">
          <div className="px-3 py-2 text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 rounded-md">
            {error}
            <button
              onClick={handleRefresh}
              className="ml-2 underline hover:no-underline"
            >
              Retry
            </button>
          </div>
        </div>
      )}

      {/* Main Sections */}
      <div className="flex-1 overflow-y-auto px-3 py-2">
        <nav className="space-y-0.5">
          {SECTIONS.map(renderSection)}
          {renderGroups()}
          {renderTrash()}
        </nav>
      </div>

      {/* Organization Move Confirmation */}
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

      {/* Empty Trash Confirmation Modal */}
      {showEmptyTrashConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
          <div className="bg-background w-full max-w-md rounded-xl shadow-2xl border border-border overflow-hidden animate-in zoom-in-95 duration-200">
            {/* Header */}
            <div className="flex items-center gap-3 px-6 py-4 border-b border-border bg-muted/30">
              <div className="rounded-lg bg-destructive/10 p-2">
                <Trash size={20} weight="duotone" className="text-destructive" />
              </div>
              <div>
                <h2 className="text-lg font-semibold">Empty Trash</h2>
                <p className="text-xs text-muted-foreground">This action cannot be undone</p>
              </div>
            </div>

            {/* Body */}
            <div className="p-6">
              <p className="text-sm text-muted-foreground">
                Are you sure you want to permanently delete{' '}
                <span className="font-medium text-foreground">{tree.trash.length} item{tree.trash.length !== 1 ? 's' : ''}</span>{' '}
                from the trash? This will free up space but the items cannot be recovered.
              </p>
            </div>

            {/* Footer */}
            <div className="flex justify-end gap-3 px-6 py-4 border-t border-border bg-muted/20">
              <Button
                variant="outline"
                size="md"
                onClick={() => setShowEmptyTrashConfirm(false)}
                disabled={emptyingTrash}
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                size="md"
                onClick={handleEmptyTrashConfirm}
                disabled={emptyingTrash}
              >
                {emptyingTrash ? 'Deleting...' : 'Delete Permanently'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
