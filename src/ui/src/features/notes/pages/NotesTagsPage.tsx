/**
 * Notes Tags Page
 *
 * Tag-based dashboard for notes. Shows all tags (whole-note and inline)
 * with counts, visualizations, and filtering capabilities.
 * Uses the same layout as the main notes page with sidebar navigation.
 */

import { useEffect, useMemo, useState, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useDocumentTitle } from '@/shared/hooks/useDocumentTitle';
import { AppHeader } from '@/components/layout/AppHeader';
import { NotesLayout } from '@/features/notes/components/NotesLayout';
import { NotesSidebar } from '@/features/notes/components/sidebar/NotesSidebar';
import { useAppSelector, useAppDispatch } from '@/app/hooks';
import { initializeNotesData } from '@/features/notes/store/notesSlice';
import { useNotesCacheSync } from '@/features/notes/hooks/useNotesCacheSync';
import {
  Tag,
  Hash,
  FileText,
  SortAscending,
  SortDescending,
  GridFour,
  List,
  X,
} from '@phosphor-icons/react';
import { cn } from '@/shared/utils/cn';

interface TagData {
  name: string;
  count: number;
  noteIds: string[];
  isInline: boolean;
  isWholeNote: boolean;
}

type SortMode = 'count' | 'alpha';
type ViewMode = 'cloud' | 'list';

/**
 * Tags Dashboard Component
 *
 * Displays all tags from notes with counts and allows filtering.
 */
function TagsDashboard() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const notes = useAppSelector((state) => state.notes?.notes ?? {});
  const loading = useAppSelector((state) => state.notes?.loading ?? false);

  const [sortMode, setSortMode] = useState<SortMode>('count');
  const [sortAsc, setSortAsc] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>('cloud');

  // Initialize selectedTag from URL param (read once on mount)
  const [selectedTag, setSelectedTag] = useState<string | null>(() => {
    const tagParam = searchParams.get('tag');
    return tagParam ? tagParam.toLowerCase() : null;
  });

  // Clear the URL param after reading it (only once on mount)
  useEffect(() => {
    if (searchParams.get('tag')) {
      setSearchParams({}, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Aggregate all tags from notes
  const tagsData = useMemo(() => {
    const tagMap = new Map<string, TagData>();
    const notesList = Object.values(notes).filter((n) => !n.isDeleted);

    for (const note of notesList) {
      // Process whole-note tags
      if (note.tags && note.tags.length > 0) {
        for (const tag of note.tags) {
          const normalizedTag = tag.toLowerCase();
          const existing = tagMap.get(normalizedTag);
          if (existing) {
            existing.count++;
            existing.noteIds.push(note.id);
            existing.isWholeNote = true;
          } else {
            tagMap.set(normalizedTag, {
              name: normalizedTag,
              count: 1,
              noteIds: [note.id],
              isInline: false,
              isWholeNote: true,
            });
          }
        }
      }

      // Process inline tags
      if (note.inlineTags && note.inlineTags.length > 0) {
        for (const tag of note.inlineTags) {
          const normalizedTag = tag.toLowerCase();
          const existing = tagMap.get(normalizedTag);
          if (existing) {
            // Only increment count if this note isn't already counted
            if (!existing.noteIds.includes(note.id)) {
              existing.count++;
              existing.noteIds.push(note.id);
            }
            existing.isInline = true;
          } else {
            tagMap.set(normalizedTag, {
              name: normalizedTag,
              count: 1,
              noteIds: [note.id],
              isInline: true,
              isWholeNote: false,
            });
          }
        }
      }
    }

    return Array.from(tagMap.values());
  }, [notes]);

  // Sort tags
  const sortedTags = useMemo(() => {
    return [...tagsData].sort((a, b) => {
      if (sortMode === 'count') {
        return sortAsc ? a.count - b.count : b.count - a.count;
      } else {
        return sortAsc
          ? a.name.localeCompare(b.name)
          : b.name.localeCompare(a.name);
      }
    });
  }, [tagsData, sortMode, sortAsc]);

  // Get notes for selected tag
  const selectedTagNotes = useMemo(() => {
    if (!selectedTag) return [];
    const tagData = tagsData.find((t) => t.name === selectedTag);
    if (!tagData) return [];
    return tagData.noteIds.map((id) => notes[id]).filter(Boolean);
  }, [selectedTag, tagsData, notes]);

  // Calculate tag sizes for cloud view (based on count)
  const maxCount = useMemo(() => Math.max(...tagsData.map((t) => t.count), 1), [tagsData]);

  const getTagSize = useCallback(
    (count: number) => {
      const ratio = count / maxCount;
      // Scale from 0.75rem to 1.5rem based on count
      return 0.75 + ratio * 0.75;
    },
    [maxCount]
  );

  const handleTagClick = useCallback((tagName: string) => {
    setSelectedTag((prev) => (prev === tagName ? null : tagName));
  }, []);

  const handleNoteClick = useCallback(
    (noteId: string) => {
      navigate(`/notes/${noteId}`);
    },
    [navigate]
  );

  // Empty state
  if (!loading && tagsData.length === 0) {
    return (
      <div className="h-full flex items-center justify-center bg-gradient-to-br from-background to-muted/30">
        <div className="text-center p-8 max-w-md">
          <div className="relative mx-auto w-24 h-24 mb-6">
            <div className="absolute inset-0 bg-primary/20 rounded-full blur-xl animate-pulse" />
            <div className="relative w-full h-full bg-gradient-to-br from-primary/10 to-primary/5 rounded-full flex items-center justify-center border border-primary/20">
              <Tag size={48} weight="duotone" className="text-primary/60" />
            </div>
          </div>
          <h2 className="text-2xl font-semibold mb-3">No Tags Yet</h2>
          <p className="text-muted-foreground mb-6 leading-relaxed">
            Add tags to your notes to organize and find them easily. Use #tagname
            inline or add whole-note tags in the editor header.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full w-full flex flex-col bg-gradient-to-br from-background via-background to-muted/20 overflow-hidden">
      {/* Header with stats and controls */}
      <div className="flex-shrink-0 border-b border-border bg-card/50 backdrop-blur-sm">
        <div className="px-6 py-4">
          {/* Controls row */}
          <div className="flex items-center gap-3">
            {/* Sort controls */}
            <div className="flex items-center gap-0.5">
              <button
                onClick={() => setSortMode('count')}
                className={cn(
                  'px-3 py-1 text-sm rounded-md transition-colors',
                  sortMode === 'count'
                    ? 'text-primary bg-primary/10'
                    : 'text-muted-foreground hover:text-foreground hover:bg-muted'
                )}
              >
                By Count
              </button>
              <button
                onClick={() => setSortMode('alpha')}
                className={cn(
                  'px-3 py-1 text-sm rounded-md transition-colors',
                  sortMode === 'alpha'
                    ? 'text-primary bg-primary/10'
                    : 'text-muted-foreground hover:text-foreground hover:bg-muted'
                )}
              >
                A-Z
              </button>
            </div>

            <button
              onClick={() => setSortAsc(!sortAsc)}
              className="p-1.5 rounded-md hover:bg-muted transition-colors"
              title={sortAsc ? 'Sort descending' : 'Sort ascending'}
            >
              {sortAsc ? (
                <SortAscending size={16} className="text-muted-foreground" />
              ) : (
                <SortDescending size={16} className="text-muted-foreground" />
              )}
            </button>

            <div className="h-6 w-px bg-border" />

            {/* View mode */}
            <div className="flex items-center gap-0.5">
              <button
                onClick={() => setViewMode('cloud')}
                className={cn(
                  'px-2 py-1 rounded-md transition-colors',
                  viewMode === 'cloud'
                    ? 'text-primary bg-primary/10'
                    : 'text-muted-foreground hover:text-foreground hover:bg-muted'
                )}
                title="Cloud view"
              >
                <GridFour size={16} />
              </button>
              <button
                onClick={() => setViewMode('list')}
                className={cn(
                  'px-2 py-1 rounded-md transition-colors',
                  viewMode === 'list'
                    ? 'text-primary bg-primary/10'
                    : 'text-muted-foreground hover:text-foreground hover:bg-muted'
                )}
                title="List view"
              >
                <List size={16} />
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Main content area */}
      <div className="flex-1 overflow-hidden flex">
        {/* Tags panel */}
        <div
          className={cn(
            'overflow-y-auto p-6 transition-all duration-300',
            selectedTag ? 'w-1/2 border-r border-border' : 'w-full'
          )}
        >
          {loading ? (
            <div className="flex items-center justify-center h-full">
              <div className="relative">
                <div className="absolute inset-0 bg-primary/20 rounded-full blur-xl animate-pulse" />
                <div className="relative animate-spin h-10 w-10 border-2 border-primary border-t-transparent rounded-full" />
              </div>
            </div>
          ) : viewMode === 'cloud' ? (
            /* Cloud view */
            <div className="flex flex-wrap gap-2 content-start">
              {sortedTags.map((tag) => (
                <button
                  key={tag.name}
                  onClick={() => handleTagClick(tag.name)}
                  className={cn(
                    'group relative inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full transition-all duration-200',
                    'hover:scale-105 hover:shadow-md',
                    selectedTag === tag.name
                      ? 'bg-primary text-primary-foreground shadow-lg shadow-primary/25'
                      : 'bg-muted/50 hover:bg-muted text-foreground'
                  )}
                  style={{
                    fontSize: `${getTagSize(tag.count)}rem`,
                  }}
                >
                  <Hash
                    size={14}
                    weight="bold"
                    className={cn(
                      'transition-colors',
                      selectedTag === tag.name
                        ? 'text-primary-foreground/70'
                        : 'text-primary'
                    )}
                  />
                  <span className="font-medium">{tag.name}</span>
                  <span
                    className={cn(
                      'text-[0.7em] px-1.5 py-0.5 rounded-full ml-0.5 transition-colors',
                      selectedTag === tag.name
                        ? 'bg-primary-foreground/20 text-primary-foreground'
                        : 'bg-primary/10 text-primary'
                    )}
                  >
                    {tag.count}
                  </span>
                </button>
              ))}
            </div>
          ) : (
            /* List view */
            <div className="space-y-1">
              {sortedTags.map((tag) => (
                <button
                  key={tag.name}
                  onClick={() => handleTagClick(tag.name)}
                  className={cn(
                    'w-full flex items-center gap-3 px-4 py-3 rounded-lg transition-all duration-200 text-left',
                    selectedTag === tag.name
                      ? 'bg-primary/10 border border-primary/30'
                      : 'hover:bg-muted/50 border border-transparent'
                  )}
                >
                  <div
                    className={cn(
                      'w-8 h-8 rounded-lg flex items-center justify-center transition-colors',
                      selectedTag === tag.name
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-muted text-muted-foreground'
                    )}
                  >
                    <Hash size={16} weight="bold" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium truncate">{tag.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {tag.count} note{tag.count !== 1 ? 's' : ''}
                      {tag.isInline && tag.isWholeNote && ' · both types'}
                      {tag.isInline && !tag.isWholeNote && ' · inline'}
                      {!tag.isInline && tag.isWholeNote && ' · note tag'}
                    </p>
                  </div>
                  <div
                    className={cn(
                      'text-sm font-semibold px-2.5 py-1 rounded-full',
                      selectedTag === tag.name
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-muted text-muted-foreground'
                    )}
                  >
                    {tag.count}
                  </div>
                </button>
              ))}
            </div>
          )}

        </div>

        {/* Selected tag notes panel */}
        {selectedTag && (
          <div className="w-1/2 overflow-y-auto p-6 bg-muted/20">
            <div className="flex items-start justify-between mb-4">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center">
                  <Hash size={16} weight="bold" className="text-primary-foreground" />
                </div>
                <div>
                  <h3 className="font-semibold">{selectedTag}</h3>
                  <p className="text-xs text-muted-foreground">
                    {selectedTagNotes.length} note{selectedTagNotes.length !== 1 ? 's' : ''}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setSelectedTag(null)}
                className="p-1.5 rounded-md hover:bg-primary/10 transition-colors"
              >
                <X size={16} className="text-primary" />
              </button>
            </div>

            <div className="space-y-2">
              {selectedTagNotes.map((note) => (
                <button
                  key={note.id}
                  onClick={() => handleNoteClick(note.id)}
                  className="w-full flex items-start gap-3 p-3 rounded-lg bg-background hover:bg-card border border-border hover:border-primary/30 transition-all text-left group"
                >
                  <div className="w-8 h-8 rounded-lg bg-muted flex items-center justify-center flex-shrink-0 group-hover:bg-primary/10 transition-colors">
                    <FileText
                      size={16}
                      weight="duotone"
                      className="text-muted-foreground group-hover:text-primary transition-colors"
                    />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium truncate group-hover:text-primary transition-colors">
                      {note.title}
                    </p>
                    {note.content && (
                      <p className="text-xs text-muted-foreground line-clamp-2 mt-0.5">
                        {note.content.slice(0, 100)}
                      </p>
                    )}
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export function NotesTagsPage() {
  const dispatch = useAppDispatch();
  const organizationId = useAppSelector((state) => state.auth.currentOrganizationId);
  const isZenMode = useAppSelector((state) => state.zenMode.isActive);
  const isSidebarOpen = useAppSelector((state) => state.editor?.isSidebarOpen ?? true);
  const notesCount = useAppSelector((state) => Object.keys(state.notes?.notes ?? {}).length);

  useDocumentTitle('Tags');

  // Sync notes to IndexedDB cache for instant load on next visit
  useNotesCacheSync();

  // Load notes on mount only if not already loaded
  // Skip fetch if notes are already in store (e.g., navigated from NotesPage)
  useEffect(() => {
    if (!organizationId || notesCount > 0) return;
    dispatch(initializeNotesData());
  }, [dispatch, organizationId, notesCount]);

  return (
    <>
      <AppHeader />
      <NotesLayout
        sidebar={<NotesSidebar />}
        editor={<TagsDashboard />}
        showSidebar={!isZenMode && isSidebarOpen}
      />
    </>
  );
}
