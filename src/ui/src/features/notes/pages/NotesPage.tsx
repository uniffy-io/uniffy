import { useEffect, useCallback, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useDocumentTitle } from "@/shared/hooks/useDocumentTitle";
import { AppHeader } from "@/components/layout/AppHeader";
import { NotesLayout } from "@/features/notes/components/NotesLayout";
import { NotesSidebar } from "@/features/notes/components/sidebar/NotesSidebar";
import { NotesEditor } from "@/features/notes/components/editor/NotesEditor";
import { NoteFolderView } from "@/features/notes/components/folder/NoteFolderView";
import { NodeType } from "@uniffy/proto/notes/v1/notes_pb";
import { NotesMetadataPanel } from "@/features/notes/components/metadata/NotesMetadataPanel";
import { useAppSelector, useAppDispatch } from "@/app/hooks";
import {
  toggleSidebar,
  setEditorMode,
  setShowMarkdownPreview,
  setShowMarkdownLineNumbers,
  setSidebarOpen,
  toggleMetadataPanel,
} from "@/features/notes/store/editorSlice";
import type { EditorMode } from "@/features/notes/store/editorSlice";
import {
  setCurrentNote,
  fetchNote,
  initializeNotesData,
  removeNote,
} from "@/features/notes/store/notesSlice";
import {
  saveLastOpenedNote,
  loadLastOpenedNote,
  clearLastOpenedNote,
} from "@/features/notes/utils/lastOpenedNote";
import { chooseNotesLanding } from "@/features/notes/utils/landing";
import { useShortcutHandler, useAppearanceSettings } from "@/features/settings";
import { useNotesCacheSync } from "@/features/notes/hooks/useNotesCacheSync";
import { recordRecentItem } from "@/features/search/utils/recentItems";
import { SearchResultType } from "@uniffy/proto/search/v1/search_pb";

export function NotesPage() {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const { noteId } = useParams<{ noteId: string }>();

  const notesState = useAppSelector((state) => state.notes);
  const editorState = useAppSelector((state) => state.editor);
  const organizationId = useAppSelector((state) => state.auth.currentOrganizationId);
  const userId = useAppSelector((state) => state.auth.user?.id);
  const isZenMode = useAppSelector((state) => state.zenMode.isActive);
  const { defaultEditor, markdownShowPreview, markdownShowLineNumbers } = useAppearanceSettings();

  useNotesCacheSync();

  const currentNoteId = notesState?.currentNoteId;
  const isSidebarOpen = editorState?.isSidebarOpen ?? true;
  const isMetadataPanelOpen = editorState?.isMetadataPanelOpen ?? false;

  const currentNote = currentNoteId ? notesState?.notes[currentNoteId] : null;
  useDocumentTitle(currentNote?.title || "Notes");

  const handleToggleSidebar = useCallback(() => {
    dispatch(toggleSidebar());
  }, [dispatch]);

  const handleCloseSidebar = useCallback(() => {
    dispatch(setSidebarOpen(false));
  }, [dispatch]);

  const handleCloseMetadataPanel = useCallback(() => {
    dispatch(toggleMetadataPanel());
  }, [dispatch]);

  useShortcutHandler("app.toggleSidebar", handleToggleSidebar);

  const hasAppliedDefaultEditor = useRef(false);
  useEffect(() => {
    if (
      !hasAppliedDefaultEditor.current &&
      defaultEditor &&
      ["crepe", "markdown", "readonly"].includes(defaultEditor)
    ) {
      dispatch(setEditorMode(defaultEditor as EditorMode));
      dispatch(setShowMarkdownPreview(markdownShowPreview));
      dispatch(setShowMarkdownLineNumbers(markdownShowLineNumbers));
      hasAppliedDefaultEditor.current = true;
    }
  }, [dispatch, defaultEditor, markdownShowPreview, markdownShowLineNumbers]);

  useEffect(() => {
    if (!organizationId || !userId || !currentNoteId || !currentNote?.title) return;
    recordRecentItem(organizationId, userId, {
      urn: `urn:uniffy:content:NOTE:${currentNoteId}`,
      title: currentNote.title,
      type: SearchResultType.NOTE,
      url: `/notes/${currentNoteId}`,
    });
  }, [organizationId, userId, currentNoteId, currentNote?.title]);

  const treeLoaded = useAppSelector((state) => state.notesTree.treeLoaded);

  // Gating on tree state (not notesCount) - fetchNote can mask an empty tree.
  useEffect(() => {
    if (!organizationId || treeLoaded) return;

    dispatch(initializeNotesData());
  }, [dispatch, organizationId, treeLoaded]);

  useEffect(() => {
    if (noteId || !treeLoaded || !organizationId || !userId) return;

    const lastOpenedId = loadLastOpenedNote(organizationId, userId);
    const landingId = chooseNotesLanding(notesState.notes, lastOpenedId);
    if (lastOpenedId && landingId !== lastOpenedId) {
      clearLastOpenedNote(organizationId, userId);
    }
    if (landingId) {
      navigate(`/notes/${landingId}`, { replace: true });
    }
  }, [noteId, treeLoaded, organizationId, userId, notesState.notes, navigate]);

  // Always refetch on noteId change or remount - returning from /chat would serve stale content and autosave could clobber concurrent edits.
  const loadedRouteNoteRef = useRef<string | null>(null);
  useEffect(() => {
    if (!noteId) return;

    loadedRouteNoteRef.current = null;
    dispatch(setCurrentNote(noteId));
    dispatch(fetchNote(noteId))
      .unwrap()
      .then(() => {
        loadedRouteNoteRef.current = noteId;
        if (organizationId && userId) {
          saveLastOpenedNote(organizationId, userId, noteId);
        }
      })
      .catch(() => {
        if (organizationId && userId && loadLastOpenedNote(organizationId, userId) === noteId) {
          clearLastOpenedNote(organizationId, userId);
        }
        dispatch(removeNote(noteId));
        dispatch(initializeNotesData({ forceRefresh: true }));
        navigate("/notes", { replace: true });
      });
  }, [noteId, organizationId, userId, dispatch, navigate]);

  useEffect(() => {
    if (!noteId || loadedRouteNoteRef.current !== noteId || notesState.notes[noteId]) return;
    if (organizationId && userId && loadLastOpenedNote(organizationId, userId) === noteId) {
      clearLastOpenedNote(organizationId, userId);
    }
    loadedRouteNoteRef.current = null;
    navigate("/notes", { replace: true });
  }, [noteId, notesState.notes, organizationId, userId, navigate]);

  return (
    <>
      <AppHeader />
      <NotesLayout
        sidebar={<NotesSidebar />}
        editor={
          currentNote?.nodeType === NodeType.FOLDER ? (
            <NoteFolderView key="folder-view" />
          ) : (
            <NotesEditor key="note-editor" />
          )
        }
        metadataPanel={currentNoteId ? <NotesMetadataPanel /> : null}
        showSidebar={!isZenMode && isSidebarOpen}
        showMetadataPanel={!isZenMode && isMetadataPanelOpen && !!currentNoteId}
        onCloseSidebar={handleCloseSidebar}
        onCloseMetadataPanel={handleCloseMetadataPanel}
      />
    </>
  );
}
