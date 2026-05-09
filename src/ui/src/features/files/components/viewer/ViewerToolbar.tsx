/**
 * Viewer Toolbar
 *
 * Top toolbar with file info, zoom controls, and actions.
 * Uses glassmorphism design for an elevated, cinematic feel.
 */

import {
    X,
    DownloadSimple,
    ArrowsOutSimple,
    ArrowsInSimple,
    MagnifyingGlassPlus,
    MagnifyingGlassMinus,
    ArrowClockwise,
    CaretLeft,
    CaretRight,
    PencilSimple,
} from '@phosphor-icons/react';
import { useAppDispatch, useAppSelector } from '@/app/hooks';
import { useFormattedKeybinding } from '@/features/settings';
import {
    toggleFullscreen,
    setZoom,
    setRotation,
    resetImageView,
    setPage,
    setPdfZoom,
} from '@/features/files/store/viewerSlice';
import type { SerializedFile } from '@/features/files/store/filesThunks';
import { formatFileSize } from '@/features/files/components/list/utils';
import { getDownloadGateState } from '@/features/files/utils/transcodeGate';

interface ViewerToolbarProps {
    file: SerializedFile;
    onClose: () => void;
    onDownload: () => void;
    onEdit?: () => void;
    isEditing?: boolean;
}

export function ViewerToolbar({ file, onClose, onDownload, onEdit, isEditing }: ViewerToolbarProps) {
    const dispatch = useAppDispatch();
    // Per-field subscriptions -- whole-slice selector re-rendered the
    // toolbar on every video timeupdate dispatch. See FileViewerModal.
    const isFullscreen = useAppSelector((state) => state.fileViewer.isFullscreen);
    const zoom = useAppSelector((state) => state.fileViewer.zoom);
    const rotation = useAppSelector((state) => state.fileViewer.rotation);
    const currentPage = useAppSelector((state) => state.fileViewer.currentPage);
    const totalPages = useAppSelector((state) => state.fileViewer.totalPages);
    const pdfZoom = useAppSelector((state) => state.fileViewer.pdfZoom);

    // Zoom percentage (100% = fit to screen)
    const zoomPercent = Math.round(zoom * 100);

    const closeShortcut = useFormattedKeybinding('viewer.close');
    const fullscreenShortcut = useFormattedKeybinding('viewer.fullscreen');
    const downloadShortcut = useFormattedKeybinding('viewer.download');
    const zoomInShortcut = useFormattedKeybinding('viewer.zoomIn');
    const zoomOutShortcut = useFormattedKeybinding('viewer.zoomOut');
    const rotateShortcut = useFormattedKeybinding('viewer.rotateRight');

    const isImage = file.mimeType.startsWith('image/');
    const isPdf = file.mimeType === 'application/pdf';
    const showImageControls = isImage && !isEditing;
    const canEdit = isImage && !isEditing;

    const downloadGate = getDownloadGateState(file.transcodeStatus);
    const downloadTitle = downloadGate.disabled
        ? (downloadGate.tooltip ?? '')
        : `Download (${downloadShortcut})`;

    const handleFullscreen = async () => {
        if (!document.fullscreenElement) {
            await document.documentElement.requestFullscreen();
        } else {
            await document.exitFullscreen();
        }
        dispatch(toggleFullscreen());
    };

    return (
        <div className="viewer-toolbar flex items-center justify-between px-4 py-2.5 z-10">
            {/* Left: Close button + File info */}
            <div className="flex items-center gap-3 min-w-0">
                <button
                    onClick={onClose}
                    className="viewer-btn p-2"
                    title={`Close (${closeShortcut})`}
                >
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
                    {/* Page navigation */}
                    <button
                        onClick={() => currentPage > 1 && dispatch(setPage(currentPage - 1))}
                        disabled={currentPage <= 1}
                        className="viewer-btn p-2"
                        title="Previous page"
                    >
                        <CaretLeft size={18} />
                    </button>
                    <span className="viewer-page-indicator text-sm">
                        {currentPage} / {totalPages || '...'}
                    </span>
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
                        onClick={() => dispatch(setPdfZoom(Math.max(0.25, pdfZoom - 0.25)))}
                        disabled={pdfZoom <= 0.25}
                        className="viewer-btn p-2"
                        title={`Zoom out (${zoomOutShortcut})`}
                    >
                        <MagnifyingGlassMinus size={18} />
                    </button>
                    <button
                        onClick={() => dispatch(setPdfZoom(1))}
                        className="viewer-zoom-display"
                        title="Reset zoom"
                    >
                        {Math.round(pdfZoom * 100)}%
                    </button>
                    <button
                        onClick={() => dispatch(setPdfZoom(Math.min(4, pdfZoom + 0.25)))}
                        disabled={pdfZoom >= 4}
                        className="viewer-btn p-2"
                        title={`Zoom in (${zoomInShortcut})`}
                    >
                        <MagnifyingGlassPlus size={18} />
                    </button>
                </div>
            )}

            {/* Empty spacer when no controls */}
            {!showImageControls && !isPdf && <div />}

            {/* Right: Actions */}
            <div className="flex items-center gap-1">
                {canEdit && onEdit && (
                    <button
                        onClick={onEdit}
                        className="viewer-btn p-2"
                        title="Edit image (E)"
                    >
                        <PencilSimple size={20} />
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
                    {isFullscreen ? (
                        <ArrowsInSimple size={20} />
                    ) : (
                        <ArrowsOutSimple size={20} />
                    )}
                </button>
            </div>
        </div>
    );
}
