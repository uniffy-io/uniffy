/**
 * File Viewer Modal
 *
 * Full-screen modal for viewing files with playlist navigation.
 * Supports images, videos, audio, PDFs, and text files.
 * Uses a cinematic dark theme optimized for media viewing.
 */

import { useEffect, useCallback, useMemo, useState } from 'react';
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
        isFullscreen,
        currentFileId,
        fileData,
        playlist,
        playlistIndex,
        zoom,
        rotation,
        currentPage,
        totalPages,
    } = useAppSelector((state) => state.fileViewer);
    const filesFromStore = useAppSelector((state) => state.files.files);

    // Get current file - prefer viewer's fileData, fallback to files store
    // This allows viewer to work when opened from search without files domain loaded
    const file: SerializedFile | null = currentFileId
        ? fileData || filesFromStore[currentFileId] || null
        : null;

    const hasNext = playlistIndex < playlist.length - 1;
    const hasPrev = playlistIndex > 0;

    // Check if current file is a PDF
    const isPdf = useMemo(() => file?.mimeType === 'application/pdf', [file?.mimeType]);
    const isImage = useMemo(() => file?.mimeType.startsWith('image/'), [file?.mimeType]);

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

    // Reset editing state when file changes
    useEffect(() => {
        // eslint-disable-next-line react-hooks/set-state-in-effect -- resetting state when currentFileId changes is valid
        setIsEditing(false);
    }, [currentFileId]);

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
    // Disable most shortcuts when in edit mode (editor has its own shortcuts)
    useShortcutHandlers(
        {
            'viewer.close': () => {
                if (isEditing) {
                    setIsEditing(false);
                } else {
                    dispatch(closeViewer());
                }
            },
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
                if (isImage && !isEditing) {
                    dispatch(setRotation((rotation + 90) % 360));
                }
            },
            'viewer.download': handleDownload,
            'viewer.edit': () => {
                if (isImage && !isEditing) {
                    handleEdit();
                }
            },
        },
        { enabled: isOpen && !isEditing }
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
                {/* Transparent backdrop with blur - see through to content */}
                <TransitionChild
                    enter="ease-out duration-300"
                    enterFrom="opacity-0"
                    enterTo="opacity-100"
                    leave="ease-in duration-200"
                    leaveFrom="opacity-100"
                    leaveTo="opacity-0"
                >
                    <div
                        className="fixed inset-0 viewer-backdrop"
                        aria-hidden="true"
                    />
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
                    <DialogPanel className={`viewer-panel viewer-context ${isFullscreen ? 'viewer-panel-fullscreen' : ''}`}>
                        {/* Toolbar - hide when editing (editor has its own toolbar) */}
                        {!isEditing && (
                            <ViewerToolbar
                                file={file}
                                onDownload={handleDownload}
                                onEdit={handleEdit}
                                isEditing={isEditing}
                            />
                        )}

                        {/* Main content area */}
                        <div className="flex-1 relative overflow-hidden">
                            {/* Previous file button - hide when editing */}
                            {hasPrev && !isEditing && (
                                <ViewerNavigation
                                    direction="prev"
                                    onClick={() => dispatch(previousFile())}
                                />
                            )}

                            {/* Content */}
                            <ViewerContent
                                file={file}
                                isEditing={isEditing}
                                initialRotation={rotation}
                                onExitEdit={handleExitEdit}
                            />

                            {/* Next file button - hide when editing */}
                            {hasNext && !isEditing && (
                                <ViewerNavigation
                                    direction="next"
                                    onClick={() => dispatch(nextFile())}
                                />
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
