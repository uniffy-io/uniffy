import { useEffect, useCallback, useMemo, useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { Dialog, DialogPanel, Transition, TransitionChild } from "@headlessui/react";
import { useAppDispatch, useAppSelector } from "@/app/hooks";
import { useShortcutHandlers } from "@/features/settings";
import {
  closeViewer,
  nextFile,
  previousFile,
  toggleFullscreen,
  togglePlay,
  setZoom,
  setRotation,
  resetImageView,
  setPage,
  setPdfRotation,
  setPdfPresentation,
  togglePdfSidebar,
} from "@/features/files/store/viewerSlice";
import { ViewerToolbar } from "@/features/files/components/viewer/ViewerToolbar";
import { ViewerNavigation } from "@/features/files/components/viewer/ViewerNavigation";
import { ViewerContent } from "@/features/files/components/viewer/ViewerContent";
import { usePlaylistPrefetch } from "@/features/files/components/viewer/hooks/usePlaylistPrefetch";
import { printPdf } from "@/features/files/components/viewer/pdf/printPdf";
import { buildMediaUrl } from "@/shared/utils/fileUrls";
import type { SerializedFile } from "@/features/files/store/filesThunks";
import { getDownloadGateState } from "@/features/files/utils/transcodeGate";

// Import viewer-specific styles
import "../../styles/viewer.css";

export function FileViewerModal() {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const location = useLocation();
  // Per-field subscriptions: video playback dispatches setCurrentTime
  // every ~250ms, so subscribing to the whole `state.fileViewer` slice
  // re-rendered the modal (and the video player) on every tick. Each
  // hook subscribes only to the field it actually reads.
  const isOpen = useAppSelector((state) => state.fileViewer.isOpen);
  const isFullscreen = useAppSelector((state) => state.fileViewer.isFullscreen);
  const currentFileId = useAppSelector((state) => state.fileViewer.currentFileId);
  const fileData = useAppSelector((state) => state.fileViewer.fileData);
  const playlist = useAppSelector((state) => state.fileViewer.playlist);
  const playlistIndex = useAppSelector((state) => state.fileViewer.playlistIndex);
  const zoom = useAppSelector((state) => state.fileViewer.zoom);
  const rotation = useAppSelector((state) => state.fileViewer.rotation);
  const currentPage = useAppSelector((state) => state.fileViewer.currentPage);
  const totalPages = useAppSelector((state) => state.fileViewer.totalPages);
  const pdfRotation = useAppSelector((state) => state.fileViewer.pdfRotation);
  const pdfPresentation = useAppSelector((state) => state.fileViewer.pdfPresentation);
  // Narrow the files-store subscription to the single row we need so an
  // unrelated file mutation does not re-render the viewer.
  const fileFromStore = useAppSelector((state) =>
    currentFileId ? (state.files.files[currentFileId] ?? null) : null,
  );

  // Prefer viewer-owned fileData (e.g. opened from search) over the files cache.
  // This allows viewer to work when opened from search without files domain loaded
  const file: SerializedFile | null = currentFileId ? fileData || fileFromStore || null : null;

  const hasNext = playlistIndex < playlist.length - 1;
  const hasPrev = playlistIndex > 0;

  usePlaylistPrefetch();

  // Check if current file is a PDF
  const isPdf = useMemo(() => file?.mimeType === "application/pdf", [file?.mimeType]);
  const isImage = useMemo(() => file?.mimeType.startsWith("image/"), [file?.mimeType]);

  // Image editing mode
  const [isEditing, setIsEditing] = useState(false);

  // Enter edit mode
  const handleEdit = useCallback(() => {
    setIsEditing(true);
  }, []);

  // Exit edit mode
  const handleExitEdit = useCallback(() => {
    setIsEditing(false);
  }, []);

  useEffect(() => {
    // Paging to another file leaves edit mode; the modal stays mounted across the switch.
    // eslint-disable-next-line react/react-compiler
    setIsEditing(false);
  }, [currentFileId]);

  const handleDownload = useCallback(() => {
    if (!file) return;
    if (getDownloadGateState(file.transcodeStatus).disabled) return;
    const link = document.createElement("a");
    link.href = buildMediaUrl(file.organizationId, file.id);
    link.download = file.filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }, [file]);

  // Always the same-origin media URL: the CSP (default-src 'self') forbids
  // framing blob: URLs, and the asset cookie authenticates the request.
  const handlePrint = useCallback(() => {
    if (!file || !isPdf) return;
    if (getDownloadGateState(file.transcodeStatus).disabled) return;
    printPdf(buildMediaUrl(file.organizationId, file.id));
  }, [file, isPdf]);

  // Close viewer and return to origin when opened via /files/:fileId deep link
  // (mention chip click, pasted URL, file row click). Without this the user
  // would be stranded on the FilesPage they never intended to visit.
  const handleClose = useCallback(() => {
    dispatch(closeViewer());
    if (/^\/files\/[^/]+/.test(location.pathname)) {
      if (location.key === "default") {
        navigate("/files", { replace: true });
      } else {
        navigate(-1);
      }
    }
  }, [dispatch, navigate, location.pathname, location.key]);

  // Disable most shortcuts when in edit mode (editor has its own shortcuts)
  useShortcutHandlers(
    {
      // Escape ordering: search (handled inside PdfSearchBar via a capture
      // listener) > presentation > edit > close viewer.
      "viewer.close": () => {
        if (pdfPresentation) {
          dispatch(setPdfPresentation(false));
          if (document.fullscreenElement) {
            void document.exitFullscreen();
          }
        } else if (isEditing) {
          setIsEditing(false);
        } else {
          handleClose();
        }
      },
      // PDF arrows page through the document, then fall through to the
      // playlist at the boundaries so every file type switches the same way.
      "viewer.next": () => {
        if (isPdf && currentPage < totalPages) {
          dispatch(setPage(currentPage + 1));
        } else if (hasNext) {
          dispatch(nextFile());
        }
      },
      "viewer.previous": () => {
        if (isPdf && currentPage > 1) {
          dispatch(setPage(currentPage - 1));
        } else if (hasPrev) {
          dispatch(previousFile());
        }
      },
      "viewer.togglePlay": () => dispatch(togglePlay()),
      "viewer.fullscreen": () => dispatch(toggleFullscreen()),
      "viewer.zoomIn": () => dispatch(setZoom(zoom + 0.25)),
      "viewer.zoomOut": () => dispatch(setZoom(Math.max(0.1, zoom - 0.25))),
      "viewer.zoomReset": () => dispatch(resetImageView()),
      "viewer.rotateRight": () => {
        if (isEditing) return;
        if (isImage) {
          dispatch(setRotation((rotation + 90) % 360));
        } else if (isPdf) {
          dispatch(setPdfRotation((pdfRotation + 90) % 360));
        }
      },
      "viewer.toggleSidebar": () => {
        if (isPdf) {
          dispatch(togglePdfSidebar());
        }
      },
      "viewer.download": handleDownload,
      "viewer.print": () => {
        if (isPdf) {
          handlePrint();
        }
      },
      "viewer.edit": () => {
        if ((isImage || isPdf) && !isEditing) {
          handleEdit();
        }
      },
    },
    { enabled: isOpen && !isEditing },
  );

  // Leaving browser fullscreen (F11/Esc at browser level) also exits presentation mode.
  useEffect(() => {
    const handleFullscreenChange = () => {
      if (!document.fullscreenElement && pdfPresentation) {
        dispatch(setPdfPresentation(false));
      }
    };

    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", handleFullscreenChange);
  }, [dispatch, pdfPresentation]);

  if (!file) {
    return null;
  }

  return (
    <Transition appear show={isOpen}>
      <Dialog onClose={handleClose} className="relative z-50">
        {/* Transparent backdrop with blur - see through to content */}
        <TransitionChild
          enter="ease-out duration-300"
          enterFrom="opacity-0"
          enterTo="opacity-100"
          leave="ease-in duration-200"
          leaveFrom="opacity-100"
          leaveTo="opacity-0"
        >
          <div className="fixed inset-0 viewer-backdrop" aria-hidden="true" />
        </TransitionChild>

        {/* Floating panel */}
        <TransitionChild
          enter="ease-out duration-300"
          enterFrom="opacity-0 scale-[0.96] translate-y-4"
          enterTo="opacity-100 scale-100 translate-y-0"
          leave="ease-in duration-200"
          leaveFrom="opacity-100 scale-100 translate-y-0"
          leaveTo="opacity-0 scale-[0.96] translate-y-4"
        >
          <DialogPanel
            className={`viewer-panel viewer-context ${isFullscreen ? "viewer-panel-fullscreen" : ""}`}
          >
            {/* Toolbar - hide when editing (editor has its own toolbar) */}
            {!isEditing && (
              <ViewerToolbar
                file={file}
                onClose={handleClose}
                onDownload={handleDownload}
                onPrint={handlePrint}
                onEdit={handleEdit}
                isEditing={isEditing}
              />
            )}

            {/* Main content area */}
            <div className="flex-1 relative overflow-hidden">
              {/* Previous file button - hide when editing */}
              {hasPrev && !isEditing && (
                <ViewerNavigation direction="prev" onClick={() => dispatch(previousFile())} />
              )}

              {/* Content: keyed by version so a restore or new
                                version remounts and fetches the new bytes. */}
              <ViewerContent
                key={`${file.id}-${file.version}`}
                file={file}
                isEditing={isEditing}
                initialRotation={rotation}
                onExitEdit={handleExitEdit}
              />

              {/* Next file button - hide when editing */}
              {hasNext && !isEditing && (
                <ViewerNavigation direction="next" onClick={() => dispatch(nextFile())} />
              )}
            </div>

            {/* File counter - show for playlist with multiple files, hide when editing */}
            {playlist.length > 1 && !isEditing && (
              <div className="viewer-counter">
                {playlistIndex + 1} / {playlist.length}
              </div>
            )}
          </DialogPanel>
        </TransitionChild>
      </Dialog>
    </Transition>
  );
}
