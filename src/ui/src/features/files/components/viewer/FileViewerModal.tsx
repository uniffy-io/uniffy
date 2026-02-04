/**
 * File Viewer Modal
 *
 * Full-screen modal for viewing files with playlist navigation.
 * Supports images, videos, audio, PDFs, and text files.
 * Uses a cinematic dark theme optimized for media viewing.
 */

import { useEffect, useCallback, useMemo } from 'react';
import { Dialog, DialogPanel, Transition, TransitionChild } from '@headlessui/react';
import { useAppDispatch, useAppSelector } from '@/app/hooks';
import { useShortcutHandlers } from '@/features/settings';
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
} from '@/features/files/store/viewerSlice';
import { ViewerToolbar } from '@/features/files/components/viewer/ViewerToolbar';
import { ViewerNavigation } from '@/features/files/components/viewer/ViewerNavigation';
import { ViewerContent } from '@/features/files/components/viewer/ViewerContent';
import type { SerializedFile } from '@/features/files/store/filesThunks';

// Import viewer-specific styles
import '../../styles/viewer.css';

export function FileViewerModal() {
    const dispatch = useAppDispatch();
    const {
        isOpen,
        currentFileId,
        playlist,
        playlistIndex,
        zoom,
        rotation,
        currentPage,
        totalPages,
    } = useAppSelector((state) => state.fileViewer);
    const files = useAppSelector((state) => state.files.files);

    // Get current file from store
    const file: SerializedFile | null = currentFileId ? files[currentFileId] || null : null;

    const hasNext = playlistIndex < playlist.length - 1;
    const hasPrev = playlistIndex > 0;

    // Check if current file is a PDF
    const isPdf = useMemo(() => file?.mimeType === 'application/pdf', [file?.mimeType]);
    const isImage = useMemo(() => file?.mimeType.startsWith('image/'), [file?.mimeType]);

    // Handle download
    const handleDownload = useCallback(() => {
        if (file) {
            // Trigger download via hidden anchor
            const link = document.createElement('a');
            link.href = `/media-stream/${file.organizationId}/${file.id}`;
            link.download = file.filename;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
        }
    }, [file]);

    // PDF page navigation
    const handlePdfPrevPage = useCallback(() => {
        if (currentPage > 1) {
            dispatch(setPage(currentPage - 1));
        }
    }, [dispatch, currentPage]);

    const handlePdfNextPage = useCallback(() => {
        if (currentPage < totalPages) {
            dispatch(setPage(currentPage + 1));
        }
    }, [dispatch, currentPage, totalPages]);

    // Keyboard shortcuts - PDF mode changes arrow key behavior
    useShortcutHandlers(
        {
            'viewer.close': () => dispatch(closeViewer()),
            'viewer.next': () => {
                if (isPdf) {
                    // In PDF mode, arrow right goes to next page
                    handlePdfNextPage();
                } else if (hasNext) {
                    dispatch(nextFile());
                }
            },
            'viewer.previous': () => {
                if (isPdf) {
                    // In PDF mode, arrow left goes to previous page
                    handlePdfPrevPage();
                } else if (hasPrev) {
                    dispatch(previousFile());
                }
            },
            'viewer.togglePlay': () => dispatch(togglePlay()),
            'viewer.fullscreen': () => dispatch(toggleFullscreen()),
            'viewer.zoomIn': () => dispatch(setZoom(zoom + 0.25)),
            'viewer.zoomOut': () => dispatch(setZoom(Math.max(0.1, zoom - 0.25))),
            'viewer.zoomReset': () => dispatch(resetImageView()),
            'viewer.rotateRight': () => {
                if (isImage) {
                    dispatch(setRotation((rotation + 90) % 360));
                }
            },
            'viewer.download': handleDownload,
        },
        { enabled: isOpen }
    );

    // Handle escape key via Dialog's onClose
    const handleClose = useCallback(() => {
        dispatch(closeViewer());
    }, [dispatch]);

    // Handle fullscreen changes
    useEffect(() => {
        const handleFullscreenChange = () => {
            if (!document.fullscreenElement) {
                // Exited fullscreen via browser UI (ESC or F11)
                // Keep our state in sync but don't close the viewer
            }
        };

        document.addEventListener('fullscreenchange', handleFullscreenChange);
        return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
    }, []);

    if (!file) {
        return null;
    }

    return (
        <Transition appear show={isOpen}>
            <Dialog onClose={handleClose} className="relative z-50">
                {/* Backdrop with cinematic dark theme */}
                <TransitionChild
                    enter="ease-out duration-200"
                    enterFrom="opacity-0"
                    enterTo="opacity-100"
                    leave="ease-in duration-150"
                    leaveFrom="opacity-100"
                    leaveTo="opacity-0"
                >
                    <div
                        className="fixed inset-0 viewer-context viewer-backdrop"
                        aria-hidden="true"
                    />
                </TransitionChild>

                {/* Modal content */}
                <TransitionChild
                    enter="ease-out duration-200"
                    enterFrom="opacity-0 scale-[0.98]"
                    enterTo="opacity-100 scale-100"
                    leave="ease-in duration-150"
                    leaveFrom="opacity-100 scale-100"
                    leaveTo="opacity-0 scale-[0.98]"
                >
                    <DialogPanel className="fixed inset-0 flex flex-col viewer-context">
                        {/* Toolbar */}
                        <ViewerToolbar file={file} onDownload={handleDownload} />

                        {/* Main content area */}
                        <div className="flex-1 relative overflow-hidden">
                            {/* Previous file button */}
                            {hasPrev && (
                                <ViewerNavigation
                                    direction="prev"
                                    onClick={() => dispatch(previousFile())}
                                />
                            )}

                            {/* Content */}
                            <ViewerContent file={file} />

                            {/* Next file button */}
                            {hasNext && (
                                <ViewerNavigation
                                    direction="next"
                                    onClick={() => dispatch(nextFile())}
                                />
                            )}
                        </div>

                        {/* File counter - show for playlist with multiple files */}
                        {playlist.length > 1 && (
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
