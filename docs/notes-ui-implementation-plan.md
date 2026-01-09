# Notes UI Implementation Plan

## Overview

This document outlines the implementation plan for the UWOS Notes feature UI. The design follows an IDE-style three-panel layout that clearly separates notes by visibility level (Personal, Group, Organization) while providing a seamless editing experience.

---

## 🎯 Design Goals

1. **Clear Visibility Hierarchy**: Make it obvious where notes live (Personal/Group/Organization)
2. **IDE-Style Navigation**: Familiar tree-based file explorer pattern
3. **Efficient Editing**: Distraction-free markdown editor with real-time autosave
4. **Seamless Sharing**: Easy transitions between visibility levels
5. **Scalable**: Handle 10 to 10,000+ notes efficiently
6. **Collaborative**: Support for real-time editing and presence indicators

---

## 📐 Architecture

### Layout Structure

```
┌─────────────────────────────────────────────────────────────────┐
│  App Header (existing)                                           │
├───────────────┬──────────────────────────┬──────────────────────┤
│               │                          │                      │
│  TREE NAV     │    EDITOR PANEL          │   METADATA PANEL     │
│  (Left)       │    (Center)              │   (Right)            │
│               │                          │                      │
│  240-320px    │    Flexible (main)       │   280-320px          │
│  Resizable    │                          │   Collapsible        │
│               │                          │                      │
└───────────────┴──────────────────────────┴──────────────────────┘
```

### Component Hierarchy

```
NotesPage
├── NotesLayout
│   ├── NotesTreeNav
│   │   ├── NotesSearchBar
│   │   ├── NewNoteButton
│   │   ├── TreeSection (Pinned)
│   │   ├── TreeSection (Personal)
│   │   ├── TreeSection (Groups)
│   │   ├── TreeSection (Organization)
│   │   └── TreeSection (Trash)
│   │
│   ├── NotesEditor
│   │   ├── EditorHeader
│   │   │   ├── NoteTitleInput
│   │   │   ├── VisibilityBadge
│   │   │   └── EditorActions
│   │   ├── MarkdownEditor
│   │   │   ├── EditorToolbar
│   │   │   └── EditorContent
│   │   ├── EditorFooter
│   │   │   ├── AutosaveStatus
│   │   │   └── ViewToggle
│   │   └── EditorTabs (multiple notes)
│   │
│   └── NotesMetadataPanel (collapsible)
│       ├── NoteInfo
│       ├── TagsEditor
│       ├── BacklinksPanel
│       ├── SharingPanel
│       └── NoteActions
│
└── Modals
    ├── ShareNoteModal
    ├── MoveNoteModal
    ├── DeleteConfirmModal
    └── VersionHistoryModal
```

---

## 📦 Redux State Structure

### Notes Slice

```typescript
interface NotesState {
  // All notes indexed by ID
  notes: Record<string, Note>;
  
  // Currently selected note ID
  currentNoteId: string | null;
  
  // Open tabs (for multi-note editing)
  openTabs: string[];
  
  // Active tab index
  activeTabIndex: number;
  
  // Loading states
  loading: boolean;
  loadingNoteId: string | null;
  
  // Error states
  error: string | null;
  
  // Filters
  filters: {
    searchQuery: string;
    visibility: VisibilityScope | 'all';
    sortBy: 'title' | 'updated' | 'created';
    sortOrder: 'asc' | 'desc';
    showDeleted: boolean;
  };
  
  // Pagination
  pagination: {
    page: number;
    pageSize: number;
    totalCount: number;
  };
}
```

### Notes Tree Slice

```typescript
interface NotesTreeState {
  // Tree structure organized by visibility
  tree: {
    pinned: TreeNode[];
    personal: TreeNode[];
    groups: GroupTreeSection[];
    organization: TreeNode[];
    trash: TreeNode[];
  };
  
  // Expanded/collapsed state
  expandedNodes: Set<string>;
  
  // Selected node in tree
  selectedNodeId: string | null;
  
  // Drag & drop state
  draggedNodeId: string | null;
  dropTargetId: string | null;
  
  // UI state
  treeWidth: number;
  isTreeCollapsed: boolean;
}

interface TreeNode {
  id: string;
  title: string;
  type: 'note' | 'folder';
  children?: TreeNode[];
  noteId?: string; // For note nodes
  folderId?: string; // For folder nodes
  isPinned?: boolean;
  isExpanded?: boolean;
}

interface GroupTreeSection {
  groupId: string;
  groupName: string;
  nodes: TreeNode[];
}
```

### Editor Slice

```typescript
interface EditorState {
  // Editor content (draft state, not saved)
  draftContent: Record<string, string>;
  
  // Unsaved changes
  hasUnsavedChanges: Record<string, boolean>;
  
  // Autosave status
  autosave: {
    lastSaved: Record<string, number>; // timestamp
    isSaving: Record<string, boolean>;
    error: Record<string, string | null>;
  };
  
  // Editor settings
  settings: {
    previewMode: 'split' | 'preview' | 'edit';
    fontSize: number;
    lineHeight: number;
    showLineNumbers: boolean;
  };
  
  // Cursor position (for autosave recovery)
  cursorPosition: Record<string, { line: number; column: number }>;
  
  // Selection state
  selection: Record<string, { start: number; end: number }>;
}
```

---

## 🛠️ Implementation Phases

### Phase 1: Foundation (Week 1-2)

**Goal**: Basic notes CRUD with three-panel layout

#### 1.1 Setup & Routing (Day 1-2)
- [ ] Create `/notes` route in App.tsx
- [ ] Setup basic NotesPage component
- [ ] Create NotesLayout with three-panel structure
- [ ] Implement panel resizing with react-resizable-panels
- [ ] Add basic responsive breakpoints

**Files to create:**
- `src/ui/src/features/notes/pages/NotesPage.tsx`
- `src/ui/src/features/notes/components/NotesLayout.tsx`
- `src/ui/src/features/notes/store/notesSlice.ts`
- `src/ui/src/features/notes/store/notesTreeSlice.ts`
- `src/ui/src/features/notes/store/editorSlice.ts`

#### 1.2 Tree Navigator (Day 3-5)
- [ ] Implement NotesTreeNav component
- [ ] Create TreeSection component (collapsible sections)
- [ ] Create TreeNode component (notes and folders)
- [ ] Add visibility indicators (icons and colors)
- [ ] Implement basic search/filter UI
- [ ] Fetch and display notes in tree structure
- [ ] Handle node selection (navigate to note)

**API Integration:**
- Use `listNotes` endpoint with visibility filters
- Group results by visibility level

**Files to create:**
- `src/ui/src/features/notes/components/tree/NotesTreeNav.tsx`
- `src/ui/src/features/notes/components/tree/TreeSection.tsx`
- `src/ui/src/features/notes/components/tree/TreeNode.tsx`
- `src/ui/src/features/notes/components/tree/NotesSearchBar.tsx`

#### 1.3 Basic Editor (Day 6-8)
- [ ] Implement NotesEditor component
- [ ] Add EditorHeader with title input
- [ ] Integrate markdown editor (use react-markdown or similar)
- [ ] Display note content
- [ ] Implement basic save functionality
- [ ] Add loading and error states

**Editor Library Options:**
- **react-markdown** + **react-simplemde-editor** (simple)
- **@uiw/react-md-editor** (good balance)
- **CodeMirror 6** (most powerful, IDE-like)

**Files to create:**
- `src/ui/src/features/notes/components/editor/NotesEditor.tsx`
- `src/ui/src/features/notes/components/editor/EditorHeader.tsx`
- `src/ui/src/features/notes/components/editor/MarkdownEditor.tsx`
- `src/ui/src/features/notes/components/editor/EditorToolbar.tsx`

#### 1.4 CRUD Operations (Day 9-10)
- [ ] Create new note functionality
- [ ] Update note (manual save)
- [ ] Delete note (move to trash)
- [ ] Restore from trash
- [ ] Permanent delete
- [ ] Basic error handling and validation

**API Integration:**
- `createNote`
- `updateNote`
- `deleteNote`
- Handle optimistic updates in Redux

**Files to create:**
- `src/ui/src/features/notes/components/NewNoteButton.tsx`
- `src/ui/src/features/notes/components/modals/DeleteConfirmModal.tsx`

---

### Phase 2: Enhanced UX (Week 3-4)

**Goal**: Folder hierarchy, autosave, and sharing

#### 2.1 Folder Hierarchy (Day 11-13)
- [ ] Implement parent_id support in tree
- [ ] Nested folder rendering
- [ ] Expand/collapse folders
- [ ] Create subfolder functionality
- [ ] Move note to folder
- [ ] Breadcrumb navigation

**Files to update:**
- Update TreeNode to support nesting
- Add folder CRUD operations

#### 2.2 Autosave (Day 14-15)
- [ ] Implement autosave debouncing (2s delay)
- [ ] Show autosave status indicator
- [ ] Handle autosave conflicts (version check)
- [ ] Recover unsaved changes on refresh
- [ ] Visual feedback for save states

**API Integration:**
- Use `autosaveNote` endpoint
- Implement version conflict detection

**Files to create:**
- `src/ui/src/features/notes/hooks/useAutosave.ts`
- `src/ui/src/features/notes/components/editor/AutosaveStatus.tsx`

#### 2.3 Visibility & Sharing (Day 16-18)
- [ ] Implement ShareNoteModal
- [ ] Change visibility level (Private → Group → Org)
- [ ] Select groups for group sharing
- [ ] Update tree when visibility changes
- [ ] Show sharing indicators in tree
- [ ] Permission-based UI (disable actions user can't perform)

**API Integration:**
- `shareNote` endpoint
- `moveNote` endpoint for visibility changes
- Fetch user's groups from auth service

**Files to create:**
- `src/ui/src/features/notes/components/modals/ShareNoteModal.tsx`
- `src/ui/src/features/notes/components/modals/MoveNoteModal.tsx`
- `src/ui/src/features/notes/components/SharingPanel.tsx`

#### 2.4 Metadata Panel (Day 19-20)
- [ ] Implement NotesMetadataPanel
- [ ] Note info display (created, updated, owner)
- [ ] Tags editor (add/remove tags)
- [ ] Visibility indicator and editor
- [ ] Note actions menu
- [ ] Panel collapse/expand

**Files to create:**
- `src/ui/src/features/notes/components/metadata/NotesMetadataPanel.tsx`
- `src/ui/src/features/notes/components/metadata/NoteInfo.tsx`
- `src/ui/src/features/notes/components/metadata/TagsEditor.tsx`
- `src/ui/src/features/notes/components/metadata/NoteActions.tsx`

---

### Phase 3: Advanced Features (Week 5-6)

**Goal**: Wiki-links, backlinks, search, and polish

#### 3.1 Wiki-Links (Day 21-23)
- [ ] Parse [[wiki-links]] in markdown
- [ ] Render as clickable links
- [ ] Autocomplete for note titles
- [ ] Create new note from broken link
- [ ] Navigate between linked notes
- [ ] Show incoming links (backlinks)

**Implementation:**
- Use regex to detect `[[title]]` pattern
- Transform to React component with onClick handler
- Implement fuzzy search for autocomplete

**Files to create:**
- `src/ui/src/features/notes/components/editor/WikiLink.tsx`
- `src/ui/src/features/notes/components/editor/WikiLinkAutocomplete.tsx`
- `src/ui/src/features/notes/components/metadata/BacklinksPanel.tsx`
- `src/ui/src/features/notes/utils/wikiLinkParser.ts`

#### 3.2 Search & Filtering (Day 24-25)
- [ ] Full-text search across all notes
- [ ] Filter by visibility
- [ ] Filter by tags
- [ ] Filter by date range
- [ ] Recent notes view
- [ ] Quick open modal (Cmd+P)

**API Integration:**
- Use `searchNotes` endpoint with full-text search
- Implement debounced search (300ms)

**Files to create:**
- `src/ui/src/features/notes/components/search/SearchPanel.tsx`
- `src/ui/src/features/notes/components/search/QuickOpenModal.tsx`
- `src/ui/src/features/notes/hooks/useNotesSearch.ts`

#### 3.3 Graph View (Day 26-27)
- [ ] Visualize note connections
- [ ] Interactive graph with zoom/pan
- [ ] Click node to open note
- [ ] Filter graph by visibility
- [ ] Show connection strength

**Library:**
- Use **react-force-graph** or **cytoscape.js**

**Files to create:**
- `src/ui/src/features/notes/components/graph/GraphView.tsx`
- `src/ui/src/features/notes/components/graph/GraphControls.tsx`

#### 3.4 Multi-Note Tabs (Day 28-29)
- [ ] Open multiple notes in tabs
- [ ] Switch between tabs
- [ ] Close tabs
- [ ] Unsaved changes indicator on tabs
- [ ] Keyboard shortcuts for tab navigation

**Files to create:**
- `src/ui/src/features/notes/components/editor/EditorTabs.tsx`
- `src/ui/src/features/notes/components/editor/EditorTab.tsx`

#### 3.5 Polish & Performance (Day 30)
- [ ] Virtual scrolling for large lists (react-window)
- [ ] Lazy loading of note content
- [ ] Memoize tree rendering
- [ ] Add loading skeletons
- [ ] Error boundaries
- [ ] Accessibility audit (ARIA labels, keyboard nav)
- [ ] Mobile responsiveness testing

---

## 🎨 UI/UX Specifications

### Color Scheme (using Tailwind classes)

**Visibility Indicators:**
```typescript
const visibilityColors = {
  PRIVATE: {
    bg: 'bg-blue-50 dark:bg-blue-950/20',
    text: 'text-blue-600 dark:text-blue-400',
    border: 'border-blue-200 dark:border-blue-800',
    icon: '🔒'
  },
  GROUP: {
    bg: 'bg-green-50 dark:bg-green-950/20',
    text: 'text-green-600 dark:text-green-400',
    border: 'border-green-200 dark:border-green-800',
    icon: '👥'
  },
  ORGANIZATION: {
    bg: 'bg-orange-50 dark:bg-orange-950/20',
    text: 'text-orange-600 dark:text-orange-400',
    border: 'border-orange-200 dark:border-orange-800',
    icon: '🏢'
  },
  PINNED: {
    bg: 'bg-yellow-50 dark:bg-yellow-950/20',
    text: 'text-yellow-600 dark:text-yellow-400',
    border: 'border-yellow-200 dark:border-yellow-800',
    icon: '📌'
  }
};
```

### Typography

- **Note titles**: `text-base font-medium`
- **Tree labels**: `text-sm font-medium text-muted-foreground`
- **Editor content**: `text-base leading-relaxed`
- **Metadata**: `text-sm text-muted-foreground`

### Spacing

- **Tree padding**: `p-2 md:p-3`
- **Node spacing**: `space-y-1`
- **Panel gaps**: `gap-4`
- **Section spacing**: `space-y-6`

### Interactions

- **Hover states**: `hover:bg-accent/50 transition-colors`
- **Active states**: `bg-accent border-l-2 border-primary`
- **Focus states**: `focus:ring-2 focus:ring-ring`

---

## 🔌 API Integration

### Endpoints Used

```typescript
// Notes Service
- listNotes(req: ListNotesRequest) → NoteListResponse
- getNote(req: GetNoteRequest) → NoteResponse
- createNote(req: CreateNoteRequest) → NoteResponse
- updateNote(req: UpdateNoteRequest) → NoteResponse
- autosaveNote(req: AutosaveNoteRequest) → AutosaveNoteResponse
- deleteNote(req: DeleteNoteRequest) → Empty
- shareNote(req: ShareNoteRequest) → NoteSharingResponse
- moveNote(req: MoveNoteRequest) → NoteResponse
- copyNote(req: CopyNoteRequest) → NoteResponse
- searchNotes(req: SearchNotesRequest) → NoteListResponse
- listBacklinks(req: ListBacklinksRequest) → BacklinkListResponse

// Auth Service (for groups)
- listGroups(req: ListGroupsRequest) → GroupListResponse
```

### Request/Response Patterns

```typescript
// Typical API call pattern
const fetchNotes = async () => {
  try {
    setLoading(true);
    const client = createClient(NotesService, transport);
    const response = await client.listNotes(
      {
        organizationId: currentOrganizationId,
        visibility: VisibilityScope.PRIVATE,
        page: 1,
        pageSize: 100,
      },
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    
    dispatch(setNotes(response.notes));
  } catch (error) {
    // Auth interceptor handles 401s
    console.error('Failed to fetch notes:', error);
    setError('Failed to load notes');
  } finally {
    setLoading(false);
  }
};
```

---

## ⌨️ Keyboard Shortcuts

### Global Shortcuts
- `Cmd/Ctrl + N` - New note
- `Cmd/Ctrl + P` - Quick open (fuzzy search)
- `Cmd/Ctrl + B` - Toggle sidebar
- `Cmd/Ctrl + Shift + F` - Global search
- `Cmd/Ctrl + ,` - Settings

### Editor Shortcuts
- `Cmd/Ctrl + S` - Manual save
- `Cmd/Ctrl + /` - Toggle preview
- `Cmd/Ctrl + K` - Insert link
- `Cmd/Ctrl + Shift + K` - Insert wiki-link
- `Cmd/Ctrl + B` - Bold
- `Cmd/Ctrl + I` - Italic
- `Cmd/Ctrl + E` - Code block

### Navigation Shortcuts
- `Cmd/Ctrl + W` - Close tab
- `Cmd/Ctrl + Tab` - Next tab
- `Cmd/Ctrl + Shift + Tab` - Previous tab
- `Cmd/Ctrl + 1-9` - Jump to tab N

---

## 📊 Performance Targets

### Load Times
- **Initial page load**: < 2s
- **Note content load**: < 500ms
- **Search results**: < 1s
- **Autosave**: < 300ms

### Rendering
- **Tree with 1000 notes**: Smooth scrolling (60fps)
- **Editor typing**: No input lag
- **Tab switching**: Instant (< 100ms)

### Optimization Strategies
- Virtual scrolling for large lists
- Lazy loading of note content
- Debounced autosave and search
- Memoized components
- Code splitting by route

---

## 🧪 Testing Strategy

### Unit Tests
- Redux reducers and actions
- Utility functions (wiki-link parser, etc.)
- Custom hooks (useAutosave, useNotesSearch)

### Integration Tests
- API integration with mock transport
- Multi-component interactions
- State management flows

### E2E Tests (Playwright/Cypress)
- Create, edit, save note
- Change visibility level
- Search and navigate
- Wiki-link creation and navigation
- Drag & drop in tree

---

## 🚀 Deployment Checklist

### Before Launch
- [ ] All Phase 1 features complete
- [ ] Error handling implemented
- [ ] Loading states polished
- [ ] Accessibility audit passed
- [ ] Mobile responsive
- [ ] Cross-browser testing (Chrome, Firefox, Safari)
- [ ] Performance benchmarks met
- [ ] Documentation complete

### Beta Release
- [ ] Phase 2 features complete
- [ ] User feedback collected
- [ ] Bug fixes prioritized

### Full Release
- [ ] Phase 3 features complete
- [ ] All tests passing
- [ ] Performance optimized
- [ ] Documentation updated

---

## 📚 Libraries & Dependencies

### Core
- `@connectrpc/connect` - API client
- `react-redux` / `@reduxjs/toolkit` - State management
- `react-router-dom` - Routing

### UI Components
- `@headlessui/react` - Modals, dropdowns
- `@heroicons/react` - Icons
- `react-resizable-panels` - Panel resizing
- `react-window` - Virtual scrolling

### Editor
- `@uiw/react-md-editor` or `react-simplemde-editor` - Markdown editor
- `react-markdown` - Markdown rendering
- `remark-gfm` - GitHub Flavored Markdown
- `rehype-highlight` - Syntax highlighting

### Utilities
- `date-fns` - Date formatting
- `lodash.debounce` - Debouncing
- `fuse.js` - Fuzzy search (client-side)

### Graph View (Phase 3)
- `react-force-graph` or `cytoscape.js` - Graph visualization

---

## 🐛 Known Challenges & Solutions

### Challenge 1: Real-time Conflict Resolution
**Problem**: Two users editing same note simultaneously

**Solution**:
- Use version field for optimistic locking
- Show conflict modal if version mismatch
- Allow user to choose: keep mine, keep theirs, or merge
- Future: WebSocket for real-time collaboration

### Challenge 2: Large Note Lists (1000+ notes)
**Problem**: DOM performance with many tree nodes

**Solution**:
- Implement virtual scrolling (react-window)
- Lazy load folder contents
- Paginate organization-level notes

### Challenge 3: Wiki-Link Performance
**Problem**: Parsing markdown on every keystroke

**Solution**:
- Debounce parsing (300ms)
- Cache parsed results
- Use Web Worker for heavy parsing

### Challenge 4: Mobile UX
**Problem**: Three-panel layout doesn't fit mobile

**Solution**:
- Single panel with bottom nav tabs
- Slide-out tree navigator
- Full-width editor
- Touch-optimized interactions

---

## 🎯 Success Metrics

### User Engagement
- **Daily Active Users**: Track note creation/editing activity
- **Notes Created**: Average per user per week
- **Session Duration**: Time spent in notes app

### Feature Adoption
- **Wiki-links Usage**: % of notes with [[links]]
- **Sharing**: % of notes shared (group/org)
- **Search**: Search queries per session

### Performance
- **Load Time**: < 2s for 95th percentile
- **Autosave Success Rate**: > 99.5%
- **Error Rate**: < 0.1% of API calls

### User Satisfaction
- **NPS Score**: Target > 40
- **Feature Requests**: Track most requested features
- **Bug Reports**: Track critical bugs

---

## 📝 Next Steps

1. **Review & Approve**: Get stakeholder sign-off on design
2. **Setup Development Environment**: Ensure all dependencies are ready
3. **Create Tickets**: Break down plan into Jira/GitHub issues
4. **Sprint Planning**: Assign tasks to sprints
5. **Begin Phase 1**: Start with foundation components

---

## 📖 References

- [UWOS Concept Doc](./uwos-concept.md)
- [Content Permissions Architecture](./architecture-content-permissions.md)
- [Permissions Usage Guide](./permissions-usage-guide.md)
- [Notes Storage Strategy](./notes-storage-strategy.md)
- [Notes Autosave Architecture](./notes-autosave.md)
- [UI Instructions](./../.github/instructions/ui.instructions.md)

---

**Document Version**: 1.0  
**Last Updated**: January 9, 2026  
**Author**: GitHub Copilot  
**Status**: Ready for Implementation
