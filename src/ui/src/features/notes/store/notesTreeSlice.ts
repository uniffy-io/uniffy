import { createSlice, createAsyncThunk } from "@reduxjs/toolkit";
import type { PayloadAction } from "@reduxjs/toolkit";
import { notesApi } from "@/features/notes/api/notesApi";
import {
  organizeNotesBySection,
  noteToTreeNode,
  sortTreeNodes,
} from "@/features/notes/utils/notesTreeUtils";
import { AccessMode, ContentType } from "@uniffy/proto/common/v1/common_pb";
import type { RootState } from "@/app/store";
import type { Note } from "@uniffy/proto/notes/v1/notes_pb";
import {
  updateNote,
  updateNoteIcon,
  initializeNotesData,
  createNote,
  deleteNote,
  restoreNote,
  moveNote,
} from "@/features/notes/store/notesThunks";
import { setContentAccessMode } from "@/features/permissions/store/permissionsThunks";
import type { NoteIcon } from "@/features/notes/utils/noteIconConstants";
import { bulkUpsertTags } from "@/features/tags/store/tagsSlice";
import { tagToPlain } from "@/features/tags/store/tagsThunks";

const noteToPlain = (note: Note) => ({
  id: note.id,
  organizationId: note.organizationId,
  ownerId: note.ownerId,
  accessMode: note.accessMode,
  baselineRole: note.baselineRole ?? null,
  userRole: note.userRole,
  nodeType: note.nodeType,
  title: note.title,
  content: note.content,
  slug: note.slug,
  isDeleted: note.isDeleted,
  version: typeof note.version === "bigint" ? Number(note.version) : note.version,
  parentId: note.parentId,
  tagIds: note.tags.map((t) => t.id),
  metadata: { ...note.metadata },
  createdAt: note.createdAt
    ? {
        seconds:
          typeof note.createdAt.seconds === "bigint"
            ? Number(note.createdAt.seconds)
            : note.createdAt.seconds,
        nanos:
          typeof note.createdAt.nanos === "bigint"
            ? Number(note.createdAt.nanos)
            : note.createdAt.nanos,
      }
    : undefined,
  updatedAt: note.updatedAt
    ? {
        seconds:
          typeof note.updatedAt.seconds === "bigint"
            ? Number(note.updatedAt.seconds)
            : note.updatedAt.seconds,
        nanos:
          typeof note.updatedAt.nanos === "bigint"
            ? Number(note.updatedAt.nanos)
            : note.updatedAt.nanos,
      }
    : undefined,
  deletedAt: note.deletedAt
    ? {
        seconds:
          typeof note.deletedAt.seconds === "bigint"
            ? Number(note.deletedAt.seconds)
            : note.deletedAt.seconds,
        nanos:
          typeof note.deletedAt.nanos === "bigint"
            ? Number(note.deletedAt.nanos)
            : note.deletedAt.nanos,
      }
    : undefined,
  outgoingReferences: [...note.outgoingReferences],
  icon: note.icon
    ? {
        type: note.icon.iconType as "icon" | "emoji",
        value: note.icon.value,
      }
    : undefined,
});

export interface TreeNode {
  id: string;
  title: string;
  type: "note" | "folder" | "canvas";
  icon?: NoteIcon;
  children?: TreeNode[];
  noteId?: string;
  folderId?: string;
  isExpanded?: boolean;
  accessMode?: number;
  ownerId?: string;
  updatedAt?: string;
}

interface NotesTreeState {
  tree: {
    bookmarked: TreeNode[];
    personal: TreeNode[];
    shared: TreeNode[];
    organization: TreeNode[];
    trash: TreeNode[];
  };
  expandedNodes: string[];
  selectedNodeId: string | null;
  draggedNodeId: string | null;
  dropTargetId: string | null;
  treeWidth: number;
  isTreeCollapsed: boolean;
  loading: boolean;
  error: string | null;
  // Distinguishes "tree hydrated" from "state.notes populated", since fetchNote/searchNotes can fill notes without tree.
  treeLoaded: boolean;
}

export const fetchNotesTree = createAsyncThunk<
  NotesTreeState["tree"],
  void,
  { state: RootState; rejectValue: string }
>("notesTree/fetchNotesTree", async (_, { getState, rejectWithValue, dispatch }) => {
  try {
    const state = getState();
    const organizationId = state.auth.currentOrganizationId;
    const currentUserId = state.auth.user?.id || "";

    if (!organizationId) {
      return rejectWithValue("No organization selected");
    }

    const pageSize = 100;

    const firstResponse = await notesApi.listNotes({
      organizationId,
      page: 1,
      pageSize,
      includeDeleted: true,
      excludeContent: true,
    });

    const allNotes = [...firstResponse.notes];

    if (firstResponse.totalPages > 1) {
      const remainingPages = Array.from({ length: firstResponse.totalPages - 1 }, (_, i) => i + 2);

      const pageResponses = await Promise.all(
        remainingPages.map((page) =>
          notesApi.listNotes({
            organizationId,
            page,
            pageSize,
            includeDeleted: true,
            excludeContent: true,
          }),
        ),
      );

      for (const response of pageResponses) {
        allNotes.push(...response.notes);
      }
    }

    const seen = new Map<string, ReturnType<typeof tagToPlain>>();
    for (const note of allNotes) {
      for (const tag of note.tags) {
        if (!seen.has(tag.id)) seen.set(tag.id, tagToPlain(tag));
      }
    }
    if (seen.size > 0) {
      dispatch(bulkUpsertTags(Array.from(seen.values())));
    }

    const notes = allNotes.map(noteToPlain);

    const organized = organizeNotesBySection(notes, currentUserId);

    return organized;
  } catch (error) {
    return rejectWithValue(error instanceof Error ? error.message : "Failed to load notes tree");
  }
});

const emptyTree: NotesTreeState["tree"] = {
  bookmarked: [],
  personal: [],
  shared: [],
  organization: [],
  trash: [],
};

const initialState: NotesTreeState = {
  tree: emptyTree,
  expandedNodes: ["personal"],
  selectedNodeId: null,
  draggedNodeId: null,
  dropTargetId: null,
  treeWidth: 280,
  isTreeCollapsed: false,
  loading: false,
  error: null,
  treeLoaded: false,
};

export const notesTreeSlice = createSlice({
  name: "notesTree",
  initialState,
  reducers: {
    setTree: (state, action: PayloadAction<NotesTreeState["tree"]>) => {
      state.tree = action.payload;
    },

    setBookmarkedNodes: (state, action: PayloadAction<TreeNode[]>) => {
      state.tree.bookmarked = action.payload;
    },

    setPersonalNodes: (state, action: PayloadAction<TreeNode[]>) => {
      state.tree.personal = action.payload;
    },

    setSharedNodes: (state, action: PayloadAction<TreeNode[]>) => {
      state.tree.shared = action.payload;
    },

    setOrganizationNodes: (state, action: PayloadAction<TreeNode[]>) => {
      state.tree.organization = action.payload;
    },

    setTrashNodes: (state, action: PayloadAction<TreeNode[]>) => {
      state.tree.trash = action.payload;
    },

    addNodeToSection: (
      state,
      action: PayloadAction<{
        section: "bookmarked" | "personal" | "shared" | "organization" | "trash";
        node: TreeNode;
        parentId?: string;
      }>,
    ) => {
      const { section, node, parentId } = action.payload;
      if (parentId) {
        state.tree[section].push(node);
      } else {
        state.tree[section].push(node);
      }
    },

    updateNodeTitle: (state, action: PayloadAction<{ nodeId: string; title: string }>) => {
      const { nodeId, title } = action.payload;
      const updateAndSort = (nodes: TreeNode[]): boolean => {
        for (const node of nodes) {
          if (node.id === nodeId) {
            node.title = title;
            sortTreeNodes(nodes);
            return true;
          }
          if (node.children && updateAndSort(node.children)) {
            return true;
          }
        }
        return false;
      };

      for (const section of [
        "bookmarked",
        "personal",
        "shared",
        "organization",
        "trash",
      ] as const) {
        if (updateAndSort(state.tree[section])) break;
      }
    },

    removeNode: (state, action: PayloadAction<string>) => {
      const nodeId = action.payload;
      const removeFromArray = (nodes: TreeNode[]): TreeNode[] => {
        return nodes
          .filter((n) => n.id !== nodeId)
          .map((n) => ({
            ...n,
            children: n.children ? removeFromArray(n.children) : undefined,
          }));
      };

      for (const section of [
        "bookmarked",
        "personal",
        "shared",
        "organization",
        "trash",
      ] as const) {
        state.tree[section] = removeFromArray(state.tree[section]);
      }
    },

    toggleNodeExpanded: (state, action: PayloadAction<string>) => {
      const nodeId = action.payload;
      const index = state.expandedNodes.indexOf(nodeId);
      if (index === -1) {
        state.expandedNodes.push(nodeId);
      } else {
        state.expandedNodes.splice(index, 1);
      }
    },

    expandNode: (state, action: PayloadAction<string>) => {
      if (!state.expandedNodes.includes(action.payload)) {
        state.expandedNodes.push(action.payload);
      }
    },

    collapseNode: (state, action: PayloadAction<string>) => {
      state.expandedNodes = state.expandedNodes.filter((id) => id !== action.payload);
    },

    expandAll: (state) => {
      const collectFolderIds = (nodes: TreeNode[]): string[] => {
        const ids: string[] = [];
        for (const node of nodes) {
          if (node.type === "folder") {
            ids.push(node.id);
            if (node.children) {
              ids.push(...collectFolderIds(node.children));
            }
          }
        }
        return ids;
      };

      state.expandedNodes = ["bookmarked", "personal", "shared", "organization", "trash"];

      for (const section of [
        "bookmarked",
        "personal",
        "shared",
        "organization",
        "trash",
      ] as const) {
        state.expandedNodes.push(...collectFolderIds(state.tree[section]));
      }
    },

    collapseAll: (state) => {
      state.expandedNodes = [];
    },

    setSelectedNode: (state, action: PayloadAction<string | null>) => {
      state.selectedNodeId = action.payload;
    },

    setDraggedNode: (state, action: PayloadAction<string | null>) => {
      state.draggedNodeId = action.payload;
    },

    setDropTarget: (state, action: PayloadAction<string | null>) => {
      state.dropTargetId = action.payload;
    },

    setTreeWidth: (state, action: PayloadAction<number>) => {
      state.treeWidth = action.payload;
    },

    toggleTreeCollapsed: (state) => {
      state.isTreeCollapsed = !state.isTreeCollapsed;
    },

    setTreeCollapsed: (state, action: PayloadAction<boolean>) => {
      state.isTreeCollapsed = action.payload;
    },

    setTreeLoading: (state, action: PayloadAction<boolean>) => {
      state.loading = action.payload;
    },

    setTreeError: (state, action: PayloadAction<string | null>) => {
      state.error = action.payload;
    },

    clearTree: (state) => {
      state.tree = emptyTree;
      state.expandedNodes = ["personal"];
      state.selectedNodeId = null;
      state.error = null;
      state.treeLoaded = false;
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchNotesTree.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(fetchNotesTree.fulfilled, (state, action) => {
        state.loading = false;
        state.tree = action.payload;
        state.treeLoaded = true;
      })
      .addCase(fetchNotesTree.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload ?? "Failed to load notes tree";
      })
      .addCase(updateNote.fulfilled, (state, action) => {
        const { id, title, icon } = action.payload;
        const updateAndSort = (nodes: TreeNode[]): boolean => {
          for (const node of nodes) {
            if (node.id === id) {
              node.title = title;
              node.icon = icon;
              sortTreeNodes(nodes);
              return true;
            }
            if (node.children && updateAndSort(node.children)) {
              return true;
            }
          }
          return false;
        };

        for (const section of [
          "bookmarked",
          "personal",
          "shared",
          "organization",
          "trash",
        ] as const) {
          if (updateAndSort(state.tree[section])) break;
        }
      })
      .addCase(updateNoteIcon.fulfilled, (state, action) => {
        const { id, icon } = action.payload;
        const updateInArray = (nodes: TreeNode[]): boolean => {
          for (const node of nodes) {
            if (node.id === id) {
              node.icon = icon;
              return true;
            }
            if (node.children && updateInArray(node.children)) {
              return true;
            }
          }
          return false;
        };

        for (const section of [
          "bookmarked",
          "personal",
          "shared",
          "organization",
          "trash",
        ] as const) {
          if (updateInArray(state.tree[section])) break;
        }
      })
      .addCase(initializeNotesData.pending, (state, action) => {
        const hasNodes =
          state.tree.personal.length > 0 ||
          state.tree.organization.length > 0 ||
          state.tree.shared.length > 0;
        if (!hasNodes && !action.meta.arg?.forceRefresh) {
          state.loading = true;
        } else if (action.meta.arg?.forceRefresh) {
          state.loading = true;
        }
        state.error = null;
      })
      .addCase(initializeNotesData.fulfilled, (state, action) => {
        state.loading = false;
        state.tree = action.payload.tree;
        state.treeLoaded = true;
      })
      .addCase(initializeNotesData.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload ?? "Failed to load notes tree";
      })
      .addCase(createNote.fulfilled, (state, action) => {
        const note = action.payload;
        const newNode: TreeNode = noteToTreeNode(note);

        const addToParent = (nodes: TreeNode[], parentId: string | undefined): boolean => {
          if (!parentId) return false;
          for (const node of nodes) {
            if (node.id === parentId) {
              if (!node.children) node.children = [];
              node.children.push(newNode);
              sortTreeNodes(node.children);
              return true;
            }
            if (node.children && addToParent(node.children, parentId)) {
              return true;
            }
          }
          return false;
        };

        // OPEN_TO_ORG -> organization, otherwise personal.
        const targetSection: "personal" | "organization" =
          note.accessMode === AccessMode.OPEN_TO_ORG ? "organization" : "personal";

        if (note.parentId) {
          const sections = ["personal", "shared", "organization"] as const;
          let added = false;
          for (const section of sections) {
            if (addToParent(state.tree[section], note.parentId)) {
              added = true;
              break;
            }
          }
          if (!added) {
            state.tree[targetSection].push(newNode);
            sortTreeNodes(state.tree[targetSection]);
          }
        } else {
          state.tree[targetSection].push(newNode);
          sortTreeNodes(state.tree[targetSection]);
        }
      })
      .addCase(deleteNote.fulfilled, (state, action) => {
        const { noteId, permanent } = action.payload;

        if (permanent) {
          const removeFromArray = (nodes: TreeNode[]): TreeNode[] => {
            return nodes
              .filter((n) => n.id !== noteId)
              .map((n) => ({
                ...n,
                children: n.children ? removeFromArray(n.children) : undefined,
              }));
          };

          for (const section of [
            "bookmarked",
            "personal",
            "shared",
            "organization",
            "trash",
          ] as const) {
            state.tree[section] = removeFromArray(state.tree[section]);
          }
        } else {
          let removedNode: TreeNode | null = null;

          const removeAndCapture = (nodes: TreeNode[]): TreeNode[] => {
            const result: TreeNode[] = [];
            for (const node of nodes) {
              if (node.id === noteId) {
                removedNode = { ...node };
              } else {
                result.push({
                  ...node,
                  children: node.children ? removeAndCapture(node.children) : undefined,
                });
              }
            }
            return result;
          };

          for (const section of ["bookmarked", "personal", "shared", "organization"] as const) {
            state.tree[section] = removeAndCapture(state.tree[section]);
          }

          if (removedNode) {
            state.tree.trash.push(removedNode);
          }
        }
      })
      .addCase(restoreNote.fulfilled, (state, action) => {
        const note = action.payload;

        state.tree.trash = state.tree.trash.filter((n) => n.id !== note.id);

        const restoredNode: TreeNode = noteToTreeNode(note);

        const section = note.accessMode === AccessMode.OPEN_TO_ORG ? "organization" : "personal";
        state.tree[section].push(restoredNode);
        sortTreeNodes(state.tree[section]);
      })
      .addCase(moveNote.fulfilled, (state, action) => {
        const note = action.payload;

        const findAndRemoveNode = (nodes: TreeNode[], nodeId: string): TreeNode | null => {
          for (let i = 0; i < nodes.length; i++) {
            if (nodes[i].id === nodeId) {
              const [removed] = nodes.splice(i, 1);
              return removed;
            }
            if (nodes[i].children) {
              const found = findAndRemoveNode(nodes[i].children!, nodeId);
              if (found) return found;
            }
          }
          return null;
        };

        let movedNode: TreeNode | null = null;
        for (const section of ["bookmarked", "personal", "shared", "organization"] as const) {
          movedNode = findAndRemoveNode(state.tree[section], note.id);
          if (movedNode) break;
        }
        if (!movedNode) {
          movedNode = noteToTreeNode(note);
        }

        movedNode.accessMode = note.accessMode;
        movedNode.ownerId = note.ownerId;
        movedNode.updatedAt = note.updatedAt?.seconds?.toString();

        const targetSection =
          note.accessMode === AccessMode.OPEN_TO_ORG ? "organization" : "personal";
        state.tree[targetSection].push(movedNode);
        sortTreeNodes(state.tree[targetSection]);
      })
      // SetAccessMode via Share dialog is distinct from moveNote RPC.
      .addCase(setContentAccessMode.fulfilled, (state, action) => {
        if (action.meta.arg.contentType !== ContentType.NOTE) return;
        const noteId = action.meta.arg.contentId;
        const newAccessMode = action.payload.policy.accessMode;

        const findAndRemoveNode = (nodes: TreeNode[], id: string): TreeNode | null => {
          for (let i = 0; i < nodes.length; i++) {
            if (nodes[i].id === id) {
              const [removed] = nodes.splice(i, 1);
              return removed;
            }
            if (nodes[i].children) {
              const found = findAndRemoveNode(nodes[i].children!, id);
              if (found) return found;
            }
          }
          return null;
        };

        let movedNode: TreeNode | null = null;
        for (const section of ["bookmarked", "personal", "shared", "organization"] as const) {
          movedNode = findAndRemoveNode(state.tree[section], noteId);
          if (movedNode) break;
        }
        if (!movedNode) return;

        movedNode.accessMode = newAccessMode;
        const targetSection =
          newAccessMode === AccessMode.OPEN_TO_ORG ? "organization" : "personal";
        state.tree[targetSection].push(movedNode);
        sortTreeNodes(state.tree[targetSection]);
      })
      .addMatcher(
        (action): action is PayloadAction<{ tree: NotesTreeState["tree"] }> =>
          action.type === "notes/backgroundRefreshComplete",
        (state, action) => {
          state.tree = action.payload.tree;
          state.treeLoaded = true;
        },
      )
      .addMatcher(
        (action): action is PayloadAction<string[]> =>
          action.type === "notesTree/setExpandedNodesFromStorage",
        (state, action) => {
          state.expandedNodes = action.payload;
        },
      );
  },
});

export const {
  setTree,
  setBookmarkedNodes,
  setPersonalNodes,
  setSharedNodes,
  setOrganizationNodes,
  setTrashNodes,
  addNodeToSection,
  updateNodeTitle,
  removeNode,
  toggleNodeExpanded,
  expandNode,
  collapseNode,
  expandAll,
  collapseAll,
  setSelectedNode,
  setDraggedNode,
  setDropTarget,
  setTreeWidth,
  toggleTreeCollapsed,
  setTreeCollapsed,
  setTreeLoading,
  setTreeError,
  clearTree,
} = notesTreeSlice.actions;

export const notesTreeReducer = notesTreeSlice.reducer;
