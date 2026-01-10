import { useState, useRef, useEffect } from 'react';
import { 
  PlusIcon, 
  ClockIcon,
  StarIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  DocumentTextIcon,
  ChevronDoubleLeftIcon,
  FolderIcon,
  LockClosedIcon,
  UserGroupIcon,
  BuildingOfficeIcon,
  TrashIcon,
  FolderPlusIcon,
  PencilIcon,
} from '@heroicons/react/24/outline';
import { useAppDispatch, useAppSelector } from '@/app/hooks';
import { setNote, setCurrentNote } from '../../store/notesSlice';
import { toggleSidebar } from '../../store/editorSlice';
import { VisibilityScope, PermissionLevel } from '@/gen/notes/v1/notes_pb';
import type { PlainMessage } from '@bufbuild/protobuf';
import type { Note } from '@/gen/notes/v1/notes_pb';

// Recursive tree node - can be a note or folder
interface TreeItem {
  id: string;
  title: string;
  type: 'note' | 'folder';
  children?: TreeItem[];
}

interface Section {
  id: string;
  name: string;
  icon: typeof FolderIcon;
  items: TreeItem[];
  scope: 'personal' | 'shared' | 'organization';
}

// Generate large mock data for stress testing
function generateMockData(): { sections: Section[], trash: TreeItem[] } {
  const noteNames = [
    'Meeting Notes', 'Project Plan', 'Research', 'Ideas', 'TODO List',
    'Documentation', 'Specs', 'Requirements', 'Design Doc', 'Architecture',
    'API Reference', 'User Guide', 'Release Notes', 'Changelog', 'Roadmap',
    'Sprint Review', 'Retrospective', 'Planning', 'Strategy', 'Analysis',
    'Report', 'Summary', 'Overview', 'Deep Dive', 'Investigation',
  ];
  
  const folderNames = [
    'Projects', 'Archive', 'Templates', 'Resources', 'References',
    'Team', 'Clients', 'Internal', 'External', 'Drafts',
    'Q1 2026', 'Q2 2026', 'Backlog', 'In Progress', 'Completed',
    'Marketing', 'Sales', 'Engineering', 'Design', 'Product',
  ];

  let nodeId = 0;
  const getId = (prefix: string) => `${prefix}-${++nodeId}`;

  // Generate random notes
  const generateNotes = (prefix: string, count: number): TreeItem[] => {
    return Array.from({ length: count }, () => ({
      id: getId(prefix),
      title: `${noteNames[Math.floor(Math.random() * noteNames.length)]} ${nodeId}`,
      type: 'note' as const,
    }));
  };

  // Generate folder with notes and possible subfolders
  const generateFolder = (prefix: string, depth: number = 0): TreeItem => {
    const folderName = folderNames[Math.floor(Math.random() * folderNames.length)];
    const children: TreeItem[] = [];
    
    // Add 2-5 notes per folder
    children.push(...generateNotes(prefix, 2 + Math.floor(Math.random() * 4)));
    
    // Add 0-2 subfolders if not too deep
    if (depth < 2) {
      const subfolderCount = Math.floor(Math.random() * 3);
      for (let i = 0; i < subfolderCount; i++) {
        children.push(generateFolder(prefix, depth + 1));
      }
    }
    
    return {
      id: getId(`${prefix}-folder`),
      title: `${folderName} ${nodeId}`,
      type: 'folder',
      children,
    };
  };

  // Personal Space: ~80 items (lots of notes, some folders)
  const personalItems: TreeItem[] = [
    ...generateNotes('personal', 15),
    generateFolder('personal'),
    generateFolder('personal'),
    generateFolder('personal'),
    ...generateNotes('personal', 10),
    generateFolder('personal'),
    generateFolder('personal'),
  ];

  // Shared: ~100 items (team collaboration)
  const sharedItems: TreeItem[] = [
    generateFolder('shared'), // Projects
    generateFolder('shared'), // Team docs
    ...generateNotes('shared', 8),
    generateFolder('shared'),
    generateFolder('shared'),
    generateFolder('shared'),
    ...generateNotes('shared', 5),
    generateFolder('shared'),
  ];

  // Organization: ~120 items (company-wide docs)
  const orgItems: TreeItem[] = [
    generateFolder('org'), // Engineering
    generateFolder('org'), // Product
    generateFolder('org'), // Design
    generateFolder('org'), // Marketing
    ...generateNotes('org', 10),
    generateFolder('org'),
    generateFolder('org'),
    generateFolder('org'),
    ...generateNotes('org', 8),
    generateFolder('org'),
  ];

  const sections: Section[] = [
    {
      id: 'personal',
      name: 'Personal Space',
      icon: LockClosedIcon,
      scope: 'personal',
      items: personalItems,
    },
    {
      id: 'shared',
      name: 'Shared',
      icon: UserGroupIcon,
      scope: 'shared',
      items: sharedItems,
    },
    {
      id: 'organization',
      name: 'Organization',
      icon: BuildingOfficeIcon,
      scope: 'organization',
      items: orgItems,
    },
  ];

  const trash: TreeItem[] = generateNotes('trash', 5);

  return { sections, trash };
}

// Generate mock data once
const { sections: initialSections, trash: initialTrash } = generateMockData();

const mockQuickAccess = {
  recent: [
    { id: 'recent-1', title: 'Sprint Planning 42' },
    { id: 'recent-2', title: 'API Reference 15' },
    { id: 'recent-3', title: 'Q1 Roadmap' },
  ],
  favorites: [
    { id: 'fav-1', title: 'Quick Reference' },
    { id: 'fav-2', title: 'Important Links' },
    { id: 'fav-3', title: 'Team Directory' },
    { id: 'fav-4', title: 'Project Templates' },
  ],
};

const mockTags = ['#roadmap', '#q1-2026', '#launch', '#priority', '#meeting-notes', '#engineering', '#design', '#product', '#urgent', '#review'];

// Helper to count all items recursively (notes only)
function countItems(items: TreeItem[]): number {
  return items.reduce((acc, item) => {
    if (item.type === 'folder' && item.children) {
      return acc + countItems(item.children);
    }
    return acc + 1;
  }, 0);
}

// Helper to add item to tree at specific parent
function addItemToTree(items: TreeItem[], parentId: string | null, newItem: TreeItem): TreeItem[] {
  if (!parentId) {
    return [...items, newItem];
  }
  
  return items.map(item => {
    if (item.id === parentId && item.type === 'folder') {
      return {
        ...item,
        children: [...(item.children || []), newItem],
      };
    }
    if (item.children) {
      return {
        ...item,
        children: addItemToTree(item.children, parentId, newItem),
      };
    }
    return item;
  });
}

// Helper to rename item in tree
function renameItemInTree(items: TreeItem[], itemId: string, newTitle: string): TreeItem[] {
  return items.map(item => {
    if (item.id === itemId) {
      return { ...item, title: newTitle };
    }
    if (item.children) {
      return {
        ...item,
        children: renameItemInTree(item.children, itemId, newTitle),
      };
    }
    return item;
  });
}

// Recursive TreeItem component
function TreeItemComponent({ 
  item, 
  depth = 0,
  expandedIds,
  onToggle,
  onNoteClick,
  onNewNote,
  onNewFolder,
  onRename,
  editingId,
  onStartEdit,
  onCancelEdit,
  currentNoteId,
  scope,
}: {
  item: TreeItem;
  depth?: number;
  expandedIds: string[];
  onToggle: (id: string) => void;
  onNoteClick: (id: string) => void;
  onNewNote: (parentId?: string) => void;
  onNewFolder: (parentId?: string) => void;
  onRename: (id: string, newTitle: string) => void;
  editingId: string | null;
  onStartEdit: (id: string) => void;
  onCancelEdit: () => void;
  currentNoteId: string | null;
  scope: 'personal' | 'shared' | 'organization';
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [editValue, setEditValue] = useState(item.title);
  const isExpanded = expandedIds.includes(item.id);
  const isFolder = item.type === 'folder';
  const hasChildren = isFolder && item.children && item.children.length > 0;
  const isEditing = editingId === item.id;

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  useEffect(() => {
    setEditValue(item.title);
  }, [item.title]);

  const handleSubmitRename = () => {
    if (editValue.trim() && editValue !== item.title) {
      onRename(item.id, editValue.trim());
    }
    onCancelEdit();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSubmitRename();
    } else if (e.key === 'Escape') {
      setEditValue(item.title);
      onCancelEdit();
    }
  };

  if (isFolder) {
    return (
      <div>
        <div
          className="w-full flex items-center gap-2 px-2 py-1.5 text-sm rounded-md hover:bg-accent transition-colors text-left group"
        >
          <button onClick={() => onToggle(item.id)} className="flex items-center">
            {isExpanded ? (
              <ChevronDownIcon className="h-3.5 w-3.5 text-muted-foreground" />
            ) : (
              <ChevronRightIcon className="h-3.5 w-3.5 text-muted-foreground" />
            )}
          </button>
          <FolderIcon className="h-4 w-4 text-muted-foreground flex-shrink-0" />
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
              onDoubleClick={() => onStartEdit(item.id)}
            >
              {item.title}
            </span>
          )}
          <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-all">
            <span
              onClick={(e) => {
                e.stopPropagation();
                onStartEdit(item.id);
              }}
              className="p-0.5 rounded hover:bg-muted"
              title="Rename"
            >
              <PencilIcon className="h-3.5 w-3.5 text-muted-foreground" />
            </span>
            <span
              onClick={(e) => {
                e.stopPropagation();
                onNewNote(item.id);
              }}
              className="p-0.5 rounded hover:bg-muted"
              title="New note"
            >
              <PlusIcon className="h-3.5 w-3.5 text-muted-foreground" />
            </span>
            <span
              onClick={(e) => {
                e.stopPropagation();
                onNewFolder(item.id);
              }}
              className="p-0.5 rounded hover:bg-muted"
              title="New folder"
            >
              <FolderPlusIcon className="h-3.5 w-3.5 text-muted-foreground" />
            </span>
          </div>
        </div>
        {isExpanded && hasChildren && (
          <div className="ml-3 pl-2 border-l border-border space-y-0.5 mt-0.5">
            {item.children!.map((child) => (
              <TreeItemComponent
                key={child.id}
                item={child}
                depth={depth + 1}
                expandedIds={expandedIds}
                onToggle={onToggle}
                onNoteClick={onNoteClick}
                onNewNote={onNewNote}
                onNewFolder={onNewFolder}
                onRename={onRename}
                editingId={editingId}
                onStartEdit={onStartEdit}
                onCancelEdit={onCancelEdit}
                currentNoteId={currentNoteId}
                scope={scope}
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
      className={`w-full flex items-center gap-2 px-2 py-1.5 text-sm rounded-md hover:bg-accent transition-colors text-left group ${
        currentNoteId === item.id ? 'bg-accent text-accent-foreground' : ''
      }`}
    >
      <DocumentTextIcon className="h-4 w-4 text-muted-foreground flex-shrink-0" />
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
          onClick={() => onNoteClick(item.id)}
          onDoubleClick={() => onStartEdit(item.id)}
        >
          {item.title}
        </span>
      )}
      <span
        onClick={(e) => {
          e.stopPropagation();
          onStartEdit(item.id);
        }}
        className="p-0.5 rounded hover:bg-muted opacity-0 group-hover:opacity-100 transition-all"
        title="Rename"
      >
        <PencilIcon className="h-3.5 w-3.5 text-muted-foreground" />
      </span>
    </div>
  );
}

export function NotesSidebar() {
  const dispatch = useAppDispatch();
  const notesState = useAppSelector((state) => state.notes);
  const currentNoteId = notesState?.currentNoteId;
  
  // Local state for tree structure
  const [sections, setSections] = useState<Section[]>(initialSections);
  const [trash, setTrash] = useState<TreeItem[]>(initialTrash);
  const [expandedIds, setExpandedIds] = useState<string[]>(['personal', 'personal-folder-1']);
  const [showTrash, setShowTrash] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  
  const handleNewNote = (scope: 'personal' | 'shared' | 'organization' = 'personal', parentId?: string) => {
    const now = Date.now();
    const noteId = `note-${now}`;
    
    let visibility = VisibilityScope.PRIVATE;
    if (scope === 'shared') {
      visibility = VisibilityScope.GROUP;
    } else if (scope === 'organization') {
      visibility = VisibilityScope.ORGANIZATION;
    }
    
    const mockNote: PlainMessage<Note> = {
      id: noteId,
      title: 'Untitled Note',
      content: '# Untitled Note\n\nStart writing here...',
      visibility,
      ownerId: 'current-user',
      organizationId: '',
      slug: '',
      createdAt: {
        seconds: Math.floor(now / 1000) as any,
        nanos: (now % 1000) * 1000000,
      },
      updatedAt: {
        seconds: Math.floor(now / 1000) as any,
        nanos: (now % 1000) * 1000000,
      },
      isPinned: false,
      isDeleted: false,
      tags: [],
      metadata: {},
      version: 1 as any,
      groupIds: [],
      userPermission: PermissionLevel.OWNER,
    };
    
    // Add to tree
    const newTreeItem: TreeItem = {
      id: noteId,
      title: 'Untitled Note',
      type: 'note',
    };
    
    setSections(prev => prev.map(section => {
      if (section.scope === scope) {
        return {
          ...section,
          items: addItemToTree(section.items, parentId || null, newTreeItem),
        };
      }
      return section;
    }));
    
    // Expand parent if specified
    if (parentId && !expandedIds.includes(parentId)) {
      setExpandedIds(prev => [...prev, parentId]);
    }
    
    dispatch(setNote(mockNote));
    dispatch(setCurrentNote(noteId));
    
    // Start editing the new note name
    setEditingId(noteId);
  };

  const handleNewFolder = (scope: 'personal' | 'shared' | 'organization', parentId?: string) => {
    const now = Date.now();
    const folderId = `folder-${now}`;
    
    const newFolder: TreeItem = {
      id: folderId,
      title: 'New Folder',
      type: 'folder',
      children: [],
    };
    
    setSections(prev => prev.map(section => {
      if (section.scope === scope) {
        return {
          ...section,
          items: addItemToTree(section.items, parentId || null, newFolder),
        };
      }
      return section;
    }));
    
    // Expand parent if specified
    if (parentId && !expandedIds.includes(parentId)) {
      setExpandedIds(prev => [...prev, parentId]);
    }
    
    // Start editing the new folder name
    setEditingId(folderId);
  };

  const handleRename = (itemId: string, newTitle: string) => {
    // Update in tree
    setSections(prev => prev.map(section => ({
      ...section,
      items: renameItemInTree(section.items, itemId, newTitle),
    })));
    
    // Update in trash if applicable
    setTrash(prev => renameItemInTree(prev, itemId, newTitle));
    
    // TODO: Update in Redux notes store if it's a note
  };

  const toggleExpanded = (id: string) => {
    setExpandedIds(prev => 
      prev.includes(id) 
        ? prev.filter(i => i !== id)
        : [...prev, id]
    );
  };

  const isExpanded = (id: string) => expandedIds.includes(id);
  
  const handleNoteClick = (noteId: string) => {
    dispatch(setCurrentNote(noteId));
  };
  
  return (
    <div className="flex flex-col h-full">
      {/* Header with New Note and Collapse */}
      <div className="flex items-center justify-between px-3 pt-3 pb-2">
        <button
          onClick={() => handleNewNote('personal')}
          className="flex items-center gap-2 px-3 py-1.5 text-sm text-primary bg-transparent hover:bg-muted rounded-md transition-colors"
        >
          <PlusIcon className="h-4 w-4" />
          <span>New Note</span>
        </button>
        <button
          onClick={() => dispatch(toggleSidebar())}
          className="p-1.5 rounded-md bg-transparent hover:bg-muted transition-colors"
          title="Toggle sidebar (⌘\\)"
        >
          <ChevronDoubleLeftIcon className="h-4 w-4 text-primary" />
        </button>
      </div>
      
      {/* Quick Access Section */}
      <div className="px-3 py-2">
        <p className="px-2 py-1 text-xs font-medium text-muted-foreground uppercase tracking-wider">
          Quick Access
        </p>
        <nav className="space-y-0.5 mt-1">
          <button className="w-full flex items-center gap-3 px-2 py-2 text-sm rounded-md hover:bg-accent transition-colors text-left">
            <ClockIcon className="h-4 w-4 text-muted-foreground" />
            <span>Recent</span>
            <span className="ml-auto text-xs text-muted-foreground">{mockQuickAccess.recent.length}</span>
          </button>
          <button className="w-full flex items-center gap-3 px-2 py-2 text-sm rounded-md hover:bg-accent transition-colors text-left">
            <StarIcon className="h-4 w-4 text-amber-500" />
            <span>Favorites</span>
            <span className="ml-auto text-xs text-muted-foreground">{mockQuickAccess.favorites.length}</span>
          </button>
        </nav>
      </div>
      
      {/* Main Sections - Permission-based */}
      <div className="flex-1 overflow-y-auto px-3 py-2">
        <p className="px-2 py-1 text-xs font-medium text-muted-foreground uppercase tracking-wider">
          Spaces
        </p>
        <nav className="space-y-0.5 mt-1">
          {sections.map((section) => {
            const IconComponent = section.icon;
            const itemCount = countItems(section.items);
            return (
              <div key={section.id}>
                <button 
                  onClick={() => toggleExpanded(section.id)}
                  className="w-full flex items-center gap-2 px-2 py-2 text-sm rounded-md hover:bg-accent transition-colors text-left group"
                >
                  {isExpanded(section.id) ? (
                    <ChevronDownIcon className="h-4 w-4 text-muted-foreground" />
                  ) : (
                    <ChevronRightIcon className="h-4 w-4 text-muted-foreground" />
                  )}
                  <IconComponent className="h-4 w-4 text-muted-foreground" />
                  <span className="flex-1">{section.name}</span>
                  <span className="text-xs text-muted-foreground">{itemCount}</span>
                  <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-all">
                    <span
                      onClick={(e) => {
                        e.stopPropagation();
                        handleNewNote(section.scope);
                      }}
                      className="p-0.5 rounded hover:bg-muted"
                      title="New note"
                    >
                      <PlusIcon className="h-3.5 w-3.5 text-muted-foreground" />
                    </span>
                    <span
                      onClick={(e) => {
                        e.stopPropagation();
                        handleNewFolder(section.scope);
                      }}
                      className="p-0.5 rounded hover:bg-muted"
                      title="New folder"
                    >
                      <FolderPlusIcon className="h-3.5 w-3.5 text-muted-foreground" />
                    </span>
                  </div>
                </button>
                
                {/* Tree items in section */}
                {isExpanded(section.id) && section.items.length > 0 && (
                  <div className="ml-4 pl-2 border-l border-border space-y-0.5 mt-0.5">
                    {section.items.map((item) => (
                      <TreeItemComponent
                        key={item.id}
                        item={item}
                        expandedIds={expandedIds}
                        onToggle={toggleExpanded}
                        onNoteClick={handleNoteClick}
                        onNewNote={(parentId) => handleNewNote(section.scope, parentId)}
                        onNewFolder={(parentId) => handleNewFolder(section.scope, parentId)}
                        onRename={handleRename}
                        editingId={editingId}
                        onStartEdit={setEditingId}
                        onCancelEdit={() => setEditingId(null)}
                        currentNoteId={currentNoteId ?? null}
                        scope={section.scope}
                      />
                    ))}
                  </div>
                )}
              </div>
            );
          })}
          
          {/* Trash Section */}
          {trash.length > 0 && (
            <div className="mt-2 pt-2 border-t border-border">
              <button 
                onClick={() => setShowTrash(!showTrash)}
                className="w-full flex items-center gap-2 px-2 py-2 text-sm rounded-md hover:bg-accent transition-colors text-left"
              >
                {showTrash ? (
                  <ChevronDownIcon className="h-4 w-4 text-muted-foreground" />
                ) : (
                  <ChevronRightIcon className="h-4 w-4 text-muted-foreground" />
                )}
                <TrashIcon className="h-4 w-4 text-muted-foreground" />
                <span className="flex-1">Trash</span>
                <span className="text-xs text-muted-foreground">{trash.length}</span>
              </button>
              
              {showTrash && (
                <div className="ml-4 pl-2 border-l border-border space-y-0.5 mt-0.5">
                  {trash.map((item) => (
                    <button
                      key={item.id}
                      onClick={() => handleNoteClick(item.id)}
                      className={`w-full flex items-center gap-2 px-2 py-1.5 text-sm rounded-md hover:bg-accent transition-colors text-left opacity-60 ${
                        currentNoteId === item.id ? 'bg-accent text-accent-foreground' : ''
                      }`}
                    >
                      <DocumentTextIcon className="h-4 w-4 text-muted-foreground" />
                      <span className="truncate">{item.title}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </nav>
      </div>
      
      {/* Tags Section */}
      <div className="px-3 py-3 border-t border-border">
        <p className="px-2 py-1 text-xs font-medium text-muted-foreground uppercase tracking-wider">
          Tags
        </p>
        <div className="flex flex-wrap gap-1.5 mt-2 px-2">
          {mockTags.map((tag) => (
            <button
              key={tag}
              className="px-2 py-1 text-xs rounded-md bg-muted hover:bg-muted/80 transition-colors"
            >
              {tag}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
