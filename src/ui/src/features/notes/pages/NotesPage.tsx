import { useEffect, useCallback, useRef } from "react";
import { useParams, useNavigate, useLocation } from "react-router-dom";
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
import { setCurrentNote, fetchNote, initializeNotesData } from "@/features/notes/store/notesSlice";
import { saveLastOpenedNote, clearLastOpenedNote } from "@/features/notes/utils/lastOpenedNote";
import { useShortcutHandler, useAppearanceSettings } from "@/features/settings";
import { useNotesCacheSync } from "@/features/notes/hooks/useNotesCacheSync";
import { recordRecentItem } from "@/features/search/utils/recentItems";
import { SearchResultType } from "@uniffy/proto/search/v1/search_pb";

export function NotesPage() {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const location = useLocation();
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

  const fromLastOpened = Boolean(
    (location.state as { fromLastOpened?: boolean } | null)?.fromLastOpened,
  );

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

  // Always refetch on noteId change or remount - returning from /chat would serve stale content and autosave could clobber concurrent edits.
  useEffect(() => {
    if (!noteId) return;

    dispatch(setCurrentNote(noteId));
    dispatch(fetchNote(noteId))
      .unwrap()
      .then(() => {
        if (organizationId && userId) {
          saveLastOpenedNote(organizationId, userId, noteId);
        }
      })
      .catch(() => {
        // A stale last-opened pointer (deleted note, revoked access) must not trap /notes in a dead redirect.
        if (fromLastOpened && organizationId && userId) {
          clearLastOpenedNote(organizationId, userId);
          navigate("/library/graph", { replace: true });
        }
      });
  }, [noteId, fromLastOpened, organizationId, userId, dispatch, navigate]);

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
