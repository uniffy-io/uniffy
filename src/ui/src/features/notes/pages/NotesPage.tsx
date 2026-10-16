import { useEffect, useCallback, useRef, useState } from "react";
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
import { chooseNotesLanding, viewRoutedNote } from "@/features/notes/utils/landing";
import type { SerializedNote } from "@/features/notes/store/notesThunks";
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

  // The routed note once its fetch landed, and whether it was opened from the trash.
  const [loadedRoute, setLoadedRoute] = useState<{ noteId: string; fromTrash: boolean } | null>(
    null,
  );
  const [shownNote, setShownNote] = useState<SerializedNote | null>(null);
  const routedView =
    noteId && loadedRoute?.noteId === noteId
      ? viewRoutedNote(notesState.notes, noteId, loadedRoute.fromTrash, shownNote)
      : null;
  // The row on screen while the note is open; a deletion or lost access leaves it in place.
  if (routedView && !routedView.lost && routedView.note !== shownNote)
    setShownNote(routedView.note);
  const routeLost = Boolean(routedView?.lost);
  const routeOpen = Boolean(routedView && !routedView.lost);
  const lostNote =
    routedView?.lost && routedView.note?.nodeType !== NodeType.FOLDER ? routedView.note : null;
  // A lost note that comes back, restored or shared again, reopens with a fresh session in place
  // of the denied one.
  const [lostNoteId, setLostNoteId] = useState<string | null>(null);
  const [editorEpoch, setEditorEpoch] = useState(0);
  if (routeLost && noteId && lostNoteId !== noteId) setLostNoteId(noteId);
  else if (routeOpen && lostNoteId === noteId) {
    setLostNoteId(null);
    setEditorEpoch((epoch) => epoch + 1);
  }
  useDocumentTitle((currentNote ?? lostNote)?.title || "Notes");

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
  useEffect(() => {
    if (!noteId) return;

    dispatch(setCurrentNote(noteId));
    dispatch(fetchNote(noteId))
      .unwrap()
      .then((loaded) => {
        setLoadedRoute({ noteId, fromTrash: Boolean(loaded.isDeleted) });
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

  // A lost note stays on screen read-only until the user navigates. A lost folder has no editor
  // to keep, so its route goes, or the page would show nothing under a URL that names it.
  useEffect(() => {
    if (!noteId || !routeLost) return;
    if (organizationId && userId && loadLastOpenedNote(organizationId, userId) === noteId) {
      clearLastOpenedNote(organizationId, userId);
    }
    if (!lostNote) navigate("/notes", { replace: true });
  }, [noteId, routeLost, lostNote, organizationId, userId, navigate]);

  // Losing the note cleared the store's selection; a note that comes back takes it again.
  useEffect(() => {
    if (noteId && routeOpen && currentNoteId !== noteId) dispatch(setCurrentNote(noteId));
  }, [noteId, routeOpen, currentNoteId, dispatch]);

  return (
    <>
      <AppHeader />
      <NotesLayout
        sidebar={<NotesSidebar />}
        editor={
          currentNote?.nodeType === NodeType.FOLDER ? (
            <NoteFolderView key="folder-view" />
          ) : (
            <NotesEditor key={`note-editor:${editorEpoch}`} lostNote={lostNote} />
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
