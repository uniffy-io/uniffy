import { useState } from "react";
import {
  X,
  DownloadSimple,
  ArrowsOutSimple,
  ArrowsInSimple,
  ArrowsHorizontal,
  BookOpen,
  FrameCorners,
  LinkSimple,
  MagnifyingGlassPlus,
  MagnifyingGlassMinus,
  ArrowClockwise,
  CaretLeft,
  CaretRight,
  FloppyDisk,
  MoonStars,
  PencilSimple,
  Presentation,
  Printer,
  SidebarSimple,
  Stamp,
} from "@phosphor-icons/react";
import { toast } from "sonner";
import { useAppDispatch, useAppSelector } from "@/app/hooks";
import { NumberInput } from "@/components/ui/number-input";
import { useFormattedKeybinding } from "@/features/settings";
import {
  toggleFullscreen,
  setZoom,
  setRotation,
  resetImageView,
  setPage,
  setPdfZoom,
  setPdfFitMode,
  setPdfRotation,
  setPdfPresentation,
  togglePdfSidebar,
  togglePdfInvert,
  togglePdfSpread,
} from "@/features/files/store/viewerSlice";
import { PdfInfoPopover } from "@/features/files/components/viewer/pdf/PdfInfoPopover";
import { ViewerVersionsPopover } from "@/features/files/components/viewer/ViewerVersionsPopover";
import { PdfWatermarkDialog } from "@/features/files/components/viewer/pdf/PdfWatermarkDialog";
import { PdfSaveDialog } from "@/features/files/components/viewer/editor/pdf/PdfSaveDialog";
import { usePdfStamper } from "@/features/files/hooks/usePdfStamper";
import type { SerializedFile } from "@/features/files/store/filesThunks";
import { formatFileSize } from "@/features/files/components/list/utils";
import { getDownloadGateState } from "@/features/files/utils/transcodeGate";
import { useBreakpoint } from "@/shared/hooks/useBreakpoint";

interface ViewerToolbarProps {
  file: SerializedFile;
  onClose: () => void;
  onDownload: () => void;
  onPrint?: () => void;
  onEdit?: () => void;
  isEditing?: boolean;
}

export function ViewerToolbar({
  file,
  onClose,
  onDownload,
  onPrint,
  onEdit,
  isEditing,
}: ViewerToolbarProps) {
  const dispatch = useAppDispatch();
  // Per-field subscriptions -- whole-slice selector re-rendered the
  // toolbar on every video timeupdate dispatch. See FileViewerModal.
  const isFullscreen = useAppSelector((state) => state.fileViewer.isFullscreen);
  const zoom = useAppSelector((state) => state.fileViewer.zoom);
  const rotation = useAppSelector((state) => state.fileViewer.rotation);
  const currentPage = useAppSelector((state) => state.fileViewer.currentPage);
  const totalPages = useAppSelector((state) => state.fileViewer.totalPages);
  const pdfZoom = useAppSelector((state) => state.fileViewer.pdfZoom);
  const pdfRotation = useAppSelector((state) => state.fileViewer.pdfRotation);
  const pdfFitMode = useAppSelector((state) => state.fileViewer.pdfFitMode);
  const pdfSidebarOpen = useAppSelector((state) => state.fileViewer.pdfSidebarOpen);
  const pdfInvert = useAppSelector((state) => state.fileViewer.pdfInvert);
  const pdfSpread = useAppSelector((state) => state.fileViewer.pdfSpread);
  const pdfPresentation = useAppSelector((state) => state.fileViewer.pdfPresentation);
  const pdfDocumentInfo = useAppSelector((state) => state.fileViewer.pdfDocumentInfo);
  const pdfWatermark = useAppSelector((state) => state.fileViewer.pdfWatermark);
  const { isDesktop } = useBreakpoint();

  const stamper = usePdfStamper(file);
  const [watermarkDialogOpen, setWatermarkDialogOpen] = useState(false);
  const [stampSaveOpen, setStampSaveOpen] = useState(false);

  // Zoom percentage (100% = fit to screen)
  const zoomPercent = Math.round(zoom * 100);

  const closeShortcut = useFormattedKeybinding("viewer.close");
  const fullscreenShortcut = useFormattedKeybinding("viewer.fullscreen");
  const downloadShortcut = useFormattedKeybinding("viewer.download");
  const zoomInShortcut = useFormattedKeybinding("viewer.zoomIn");
  const zoomOutShortcut = useFormattedKeybinding("viewer.zoomOut");
  const rotateShortcut = useFormattedKeybinding("viewer.rotateRight");
  const sidebarShortcut = useFormattedKeybinding("viewer.toggleSidebar");
  const printShortcut = useFormattedKeybinding("viewer.print");

  const isImage = file.mimeType.startsWith("image/");
  const isPdf = file.mimeType === "application/pdf";
  const showImageControls = isImage && !isEditing;
  const canEdit = (isImage || isPdf) && !isEditing;

  const downloadGate = getDownloadGateState(file.transcodeStatus);
  const downloadTitle = downloadGate.disabled
    ? (downloadGate.tooltip ?? "")
    : `Download (${downloadShortcut})`;

  const handleFullscreen = async () => {
    if (!document.fullscreenElement) {
      await document.documentElement.requestFullscreen();
    } else {
      await document.exitFullscreen();
    }
    dispatch(toggleFullscreen());
  };

  const handlePresentationToggle = async () => {
    if (pdfPresentation) {
      dispatch(setPdfPresentation(false));
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      }
    } else {
      dispatch(setPdfPresentation(true));
      if (!document.fullscreenElement) {
        await document.documentElement.requestFullscreen().catch(() => {});
      }
    }
  };

  const handleCopyPageLink = async () => {
    const url = `${window.location.origin}/files/${file.id}?page=${currentPage}`;
    try {
      await navigator.clipboard.writeText(url);
      toast.success("Page link copied");
    } catch {
      toast.error("Failed to copy link");
    }
  };

  return (
    <div className="viewer-toolbar flex items-center justify-between px-4 py-2.5 z-10">
      {/* Left: Close button + File info */}
      <div className="flex items-center gap-3 min-w-0">
        <button onClick={onClose} className="viewer-btn p-2" title={`Close (${closeShortcut})`}>
          <X size={20} weight="bold" />
        </button>
        <div className="viewer-file-info">
          <h2 className="viewer-file-name">{file.filename}</h2>
          <p className="viewer-file-size">{formatFileSize(file.sizeBytes)}</p>
        </div>
      </div>

      {/* Center: Image controls */}
      {showImageControls && (
        <div className="flex items-center gap-1">
          <button
            onClick={() => dispatch(setZoom(Math.max(0.1, zoom - 0.25)))}
            className="viewer-btn p-2"
            title={`Zoom out (${zoomOutShortcut})`}
          >
            <MagnifyingGlassMinus size={18} />
          </button>
          <button
            onClick={() => dispatch(resetImageView())}
            className="viewer-zoom-display"
            title="Reset zoom (fit to screen)"
          >
            {zoomPercent}%
          </button>
          <button
            onClick={() => dispatch(setZoom(zoom + 0.25))}
            className="viewer-btn p-2"
            title={`Zoom in (${zoomInShortcut})`}
          >
            <MagnifyingGlassPlus size={18} />
          </button>
          <button
            onClick={() => dispatch(setRotation((rotation + 90) % 360))}
            className="viewer-btn p-2 ml-2"
            title={`Rotate (${rotateShortcut})`}
          >
            <ArrowClockwise size={18} />
          </button>
        </div>
      )}

      {/* Center: PDF controls */}
      {isPdf && (
        <div className="flex items-center gap-2">
          <button
            onClick={() => dispatch(togglePdfSidebar())}
            className={`viewer-btn p-2 ${pdfSidebarOpen ? "bg-white/10" : ""}`}
            title={`Toggle sidebar (${sidebarShortcut})`}
          >
            <SidebarSimple size={18} />
          </button>

          <div className="viewer-divider" />

          {/* Page navigation */}
          <button
            onClick={() => currentPage > 1 && dispatch(setPage(currentPage - 1))}
            disabled={currentPage <= 1}
            className="viewer-btn p-2"
            title="Previous page"
          >
            <CaretLeft size={18} />
          </button>
          <PageJumpInput
            currentPage={currentPage}
            totalPages={totalPages}
            onJump={(page) => dispatch(setPage(page))}
          />
          <button
            onClick={() => currentPage < totalPages && dispatch(setPage(currentPage + 1))}
            disabled={currentPage >= totalPages}
            className="viewer-btn p-2"
            title="Next page"
          >
            <CaretRight size={18} />
          </button>

          <div className="viewer-divider" />

          {/* Zoom controls */}
          <button
            onClick={() => {
              dispatch(setPdfZoom(Math.max(0.25, pdfZoom - 0.25)));
              dispatch(setPdfFitMode("custom"));
            }}
            disabled={pdfZoom <= 0.25}
            className="viewer-btn p-2"
            title={`Zoom out (${zoomOutShortcut})`}
          >
            <MagnifyingGlassMinus size={18} />
          </button>
          <button
            onClick={() => {
              dispatch(setPdfZoom(1));
              dispatch(setPdfFitMode("custom"));
            }}
            className="viewer-zoom-display"
            title="Reset zoom"
          >
            {Math.round(pdfZoom * 100)}%
          </button>
          <button
            onClick={() => {
              dispatch(setPdfZoom(Math.min(4, pdfZoom + 0.25)));
              dispatch(setPdfFitMode("custom"));
            }}
            disabled={pdfZoom >= 4}
            className="viewer-btn p-2"
            title={`Zoom in (${zoomInShortcut})`}
          >
            <MagnifyingGlassPlus size={18} />
          </button>

          <button
            onClick={() => dispatch(setPdfFitMode("width"))}
            className={`viewer-btn p-2 ${pdfFitMode === "width" ? "bg-white/10" : ""}`}
            title="Fit width"
          >
            <ArrowsHorizontal size={18} />
          </button>
          <button
            onClick={() => dispatch(setPdfFitMode("page"))}
            className={`viewer-btn p-2 ${pdfFitMode === "page" ? "bg-white/10" : ""}`}
            title="Fit page"
          >
            <FrameCorners size={18} />
          </button>

          <button
            onClick={() => dispatch(setPdfRotation((pdfRotation + 90) % 360))}
            className="viewer-btn p-2 ml-2"
            title={`Rotate (${rotateShortcut})`}
          >
            <ArrowClockwise size={18} />
          </button>

          <div className="viewer-divider" />

          <button
            onClick={() => dispatch(togglePdfInvert())}
            className={`viewer-btn p-2 ${pdfInvert ? "bg-white/10" : ""}`}
            title="Night reading mode"
          >
            <MoonStars size={18} />
          </button>
          {isDesktop && (
            <button
              onClick={() => dispatch(togglePdfSpread())}
              className={`viewer-btn p-2 ${pdfSpread ? "bg-white/10" : ""}`}
              title="Two-page spread"
            >
              <BookOpen size={18} />
            </button>
          )}
          <button
            onClick={() => void handlePresentationToggle()}
            className={`viewer-btn p-2 ${pdfPresentation ? "bg-white/10" : ""}`}
            title="Presentation mode"
          >
            <Presentation size={18} />
          </button>

          <div className="viewer-divider" />

          <button
            onClick={() => setWatermarkDialogOpen(true)}
            className={`viewer-btn p-2 ${pdfWatermark ? "bg-white/10" : ""}`}
            title="Watermark"
          >
            <Stamp size={18} />
          </button>
          {stamper.hasStamps && (
            <button
              onClick={() => setStampSaveOpen(true)}
              disabled={stamper.isSaving}
              className="viewer-btn-primary px-3 py-1.5 text-sm inline-flex items-center gap-1.5 ml-1"
              title="Save watermarked copy"
            >
              <FloppyDisk size={16} />
              Save
            </button>
          )}
        </div>
      )}

      {/* Empty spacer when no controls */}
      {!showImageControls && !isPdf && <div />}

      {/* Right: Actions */}
      <div className="flex items-center gap-1">
        {canEdit && onEdit && (
          <button onClick={onEdit} className="viewer-btn p-2" title="Edit (E)">
            <PencilSimple size={20} />
          </button>
        )}
        <ViewerVersionsPopover key={file.id} file={file} />
        {isPdf && (
          <PdfInfoPopover info={pdfDocumentInfo} numPages={totalPages} sizeBytes={file.sizeBytes} />
        )}
        {isPdf && (
          <button
            onClick={() => void handleCopyPageLink()}
            className="viewer-btn p-2"
            title="Copy link to page"
          >
            <LinkSimple size={20} />
          </button>
        )}
        {isPdf && onPrint && (
          <button
            onClick={onPrint}
            disabled={downloadGate.disabled}
            className="viewer-btn p-2 disabled:opacity-50 disabled:cursor-not-allowed"
            title={
              downloadGate.disabled ? (downloadGate.tooltip ?? "") : `Print (${printShortcut})`
            }
          >
            <Printer size={20} />
          </button>
        )}
        <button
          onClick={onDownload}
          disabled={downloadGate.disabled}
          className="viewer-btn p-2 disabled:opacity-50 disabled:cursor-not-allowed"
          title={downloadTitle}
        >
          <DownloadSimple size={20} />
        </button>
        <button
          onClick={handleFullscreen}
          className="viewer-btn p-2"
          title={`Fullscreen (${fullscreenShortcut})`}
        >
          {isFullscreen ? <ArrowsInSimple size={20} /> : <ArrowsOutSimple size={20} />}
        </button>
      </div>

      {isPdf && (
        <>
          <PdfWatermarkDialog
            isOpen={watermarkDialogOpen}
            onClose={() => setWatermarkDialogOpen(false)}
          />
          <PdfSaveDialog
            isOpen={stampSaveOpen}
            intent="stamp"
            originalFilename={file.filename}
            isSaving={stamper.isSaving}
            error={stamper.saveError}
            onClose={() => {
              setStampSaveOpen(false);
              stamper.clearSaveError();
            }}
            onSaveAsNew={async (name) => {
              const success = await stamper.saveAsNewFile(name);
              if (success) setStampSaveOpen(false);
              return success;
            }}
            onSaveAsVersion={async () => {
              const success = await stamper.saveAsNewVersion();
              if (success) setStampSaveOpen(false);
              return success;
            }}
          />
        </>
      )}
    </div>
  );
}

interface PageJumpInputProps {
  currentPage: number;
  totalPages: number;
  onJump: (page: number) => void;
}

function PageJumpInput({ currentPage, totalPages, onJump }: PageJumpInputProps) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState("");

  if (!editing) {
    return (
      <button
        onClick={() => {
          setValue(String(currentPage));
          setEditing(true);
        }}
        className="viewer-page-indicator text-sm"
        title="Go to page"
      >
        {currentPage} / {totalPages || "..."}
      </button>
    );
  }

  return (
    <NumberInput
      min={1}
      max={totalPages}
      autoFocus
      value={value}
      onChange={(event) => setValue(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          const parsed = Number.parseInt(value, 10);
          if (Number.isFinite(parsed)) {
            onJump(Math.min(Math.max(parsed, 1), totalPages));
          }
          setEditing(false);
        } else if (event.key === "Escape") {
          // Cancel the edit without letting viewer.close see the keypress.
          event.stopPropagation();
          setEditing(false);
        }
      }}
      onBlur={() => setEditing(false)}
      className="viewer-page-input h-auto"
      aria-label="Go to page"
    />
  );
}
