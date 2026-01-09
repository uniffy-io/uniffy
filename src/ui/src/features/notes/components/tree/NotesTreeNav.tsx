import { useState } from 'react';
import { MagnifyingGlassIcon, PlusIcon, LockClosedIcon, UserGroupIcon, BuildingOfficeIcon, TrashIcon, DocumentTextIcon } from '@heroicons/react/24/outline';
import { useAppDispatch, useAppSelector } from '@/app/hooks';
import { setSearchQuery, setNote, setCurrentNote } from '../../store/notesSlice';
import { setPersonalNodes, expandNode } from '../../store/notesTreeSlice';
import { TreeSection } from './TreeSection';
import { VisibilityScope, PermissionLevel } from '@/gen/notes/v1/notes_pb';
import type { PlainMessage } from '@bufbuild/protobuf';
import type { Note } from '@/gen/notes/v1/notes_pb';

export function NotesTreeNav() {
  const dispatch = useAppDispatch();
  const { filters } = useAppSelector((state) => state.notes);
  const { tree, expandedNodes } = useAppSelector((state) => state.notesTree);
  
  const [localSearch, setLocalSearch] = useState(filters.searchQuery);
  
  const handleSearchChange = (value: string) => {
    setLocalSearch(value);
    // Debounced dispatch would go here
    dispatch(setSearchQuery(value));
  };
  
  const handleNewNote = () => {
    // Create a temporary mock note with serializable values
    const now = Date.now();
    const mockNote: PlainMessage<Note> = {
      id: `temp-${now}`,
      title: 'Untitled Note',
      content: '',
      visibility: VisibilityScope.PRIVATE,
      ownerId: 'current-user', // TODO: Get from auth state
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
    
    // Add note to store
    dispatch(setNote(mockNote));
    dispatch(setCurrentNote(mockNote.id));
    
    // Add to tree
    const newTreeNode = {
      id: mockNote.id,
      title: mockNote.title,
      type: 'note' as const,
      noteId: mockNote.id,
      visibility: mockNote.visibility,
    };
    
    dispatch(setPersonalNodes([...tree.personal, newTreeNode]));
    dispatch(expandNode('personal'));
    
    console.log('Created temporary note:', mockNote.id);
  };
  
  const isSectionExpanded = (sectionId: string) => {
    return expandedNodes.includes(sectionId);
  };
  
  return (
    <div className="flex flex-col h-full bg-card">
      {/* Header */}
      <div className="p-4 border-b border-border">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold">Notes</h2>
          <button
            onClick={handleNewNote}
            className="p-1.5 rounded-md hover:bg-accent transition-colors"
            title="New Note"
          >
            <PlusIcon className="h-5 w-5" />
          </button>
        </div>
        
        {/* Search */}
        <div className="relative">
          <MagnifyingGlassIcon className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input
            type="text"
            value={localSearch}
            onChange={(e) => handleSearchChange(e.target.value)}
            placeholder="Search notes..."
            className="w-full pl-9 pr-3 py-2 text-sm border border-input bg-background rounded-md focus:ring-2 focus:ring-ring outline-none transition-all"
          />
        </div>
      </div>
      
      {/* Tree Sections */}
      <div className="flex-1 overflow-y-auto p-2 space-y-1">
        {/* Pinned Notes */}
        {tree.pinned.length > 0 && (
          <TreeSection
            title="Pinned"
            IconComponent={DocumentTextIcon}
            nodes={tree.pinned}
            sectionId="pinned"
            isExpanded={isSectionExpanded('pinned')}
            count={tree.pinned.length}
          />
        )}
        
        {/* Personal Notes */}
        <TreeSection
          title="Personal"
          IconComponent={LockClosedIcon}
          nodes={tree.personal}
          sectionId="personal"
          isExpanded={isSectionExpanded('personal')}
          count={tree.personal.length}
          accentColor="text-blue-600 dark:text-blue-400"
        />
        
        {/* Group Notes */}
        {tree.groups.map((group) => (
          <TreeSection
            key={group.groupId}
            title={group.groupName}
            IconComponent={UserGroupIcon}
            nodes={group.nodes}
            sectionId={`group-${group.groupId}`}
            isExpanded={isSectionExpanded(`group-${group.groupId}`)}
            count={group.nodes.length}
            accentColor="text-green-600 dark:text-green-400"
          />
        ))}
        
        {/* Organization Notes */}
        <TreeSection
          title="Organization"
          IconComponent={BuildingOfficeIcon}
          nodes={tree.organization}
          sectionId="organization"
          isExpanded={isSectionExpanded('organization')}
          count={tree.organization.length}
          accentColor="text-orange-600 dark:text-orange-400"
        />
        
        {/* Trash */}
        {tree.trash.length > 0 && (
          <TreeSection
            title="Trash"
            IconComponent={TrashIcon}
            nodes={tree.trash}
            sectionId="trash"
            isExpanded={isSectionExpanded('trash')}
            count={tree.trash.length}
            accentColor="text-red-600 dark:text-red-400"
          />
        )}
        
        {/* Empty State */}
        {tree.pinned.length === 0 && 
         tree.personal.length === 0 && 
         tree.groups.length === 0 && 
         tree.organization.length === 0 && 
         tree.trash.length === 0 && (
          <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
            <DocumentTextIcon className="h-12 w-12 text-muted-foreground/50 mb-3" />
            <p className="text-sm font-medium text-foreground mb-1">No notes yet</p>
            <p className="text-xs text-muted-foreground mb-4">Create your first note to get started</p>
            <button
              onClick={handleNewNote}
              className="px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm font-medium hover:bg-primary/90 transition-colors"
            >
              Create Note
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
