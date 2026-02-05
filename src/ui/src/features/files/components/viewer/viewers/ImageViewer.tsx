/**
 * Image Viewer
 *
 * Displays images with zoom, pan, and rotate support.
 * Images automatically fit to the container by default.
 * Zoom is relative to the fitted size (100% = fit to screen).
 */

import { useState, useRef, useCallback, useEffect } from 'react';
import { Spinner } from '@phosphor-icons/react';
import { useAppDispatch, useAppSelector } from '@/app/hooks';
import { setZoom, setPan, setViewerLoading } from '@/features/files/store/viewerSlice';
import { useFileDownload } from '@/features/files/components/viewer/hooks/useFileDownload';
import type { SerializedFile } from '@/features/files/store/filesThunks';

interface ImageViewerProps {
    file: SerializedFile;
}

export function ImageViewer({ file }: ImageViewerProps) {
    const dispatch = useAppDispatch();
    const { zoom, panX, panY, rotation, loading } = useAppSelector((state) => state.fileViewer);
    const { url: imageUrl, loading: downloadLoading, error: downloadError } = useFileDownload(file.id);

    const [isDragging, setIsDragging] = useState(false);
    const [imageLoaded, setImageLoaded] = useState(false);
    const lastPos = useRef({ x: 0, y: 0 });
    const containerRef = useRef<HTMLDivElement>(null);

    // Handle image load
    const handleImageLoad = useCallback(() => {
        setImageLoaded(true);
        dispatch(setViewerLoading(false));
    }, [dispatch]);

    // Handle image error
    const handleImageError = useCallback(() => {
        dispatch(setViewerLoading(false));
    }, [dispatch]);

    // Mouse wheel zoom
    useEffect(() => {
        const container = containerRef.current;
        if (!container) return;

        const handleWheel = (e: WheelEvent) => {
            e.preventDefault();
            const delta = e.deltaY > 0 ? -0.1 : 0.1;
            dispatch(setZoom(Math.max(0.1, Math.min(10, zoom + delta))));
        };

        container.addEventListener('wheel', handleWheel, { passive: false });
        return () => container.removeEventListener('wheel', handleWheel);
    }, [dispatch, zoom]);

    // Start dragging
    const handleMouseDown = useCallback((e: React.MouseEvent) => {
        if (e.button !== 0) return;
        e.preventDefault();
        setIsDragging(true);
        lastPos.current = { x: e.clientX, y: e.clientY };
    }, []);

    // Pan with mouse drag
    const handleMouseMove = useCallback(
        (e: React.MouseEvent) => {
            if (!isDragging) return;
            const deltaX = e.clientX - lastPos.current.x;
            const deltaY = e.clientY - lastPos.current.y;
            dispatch(setPan({ x: panX + deltaX, y: panY + deltaY }));
            lastPos.current = { x: e.clientX, y: e.clientY };
        },
        [isDragging, dispatch, panX, panY]
    );

    // Stop dragging
    const handleMouseUp = useCallback(() => {
        setIsDragging(false);
    }, []);

    // Handle mouse leave
    const handleMouseLeave = useCallback(() => {
        setIsDragging(false);
    }, []);

    // Touch support for mobile
    const handleTouchStart = useCallback((e: React.TouchEvent) => {
        if (e.touches.length === 1) {
            const touch = e.touches[0];
            setIsDragging(true);
            lastPos.current = { x: touch.clientX, y: touch.clientY };
        }
    }, []);

    const handleTouchMove = useCallback(
        (e: React.TouchEvent) => {
            if (!isDragging || e.touches.length !== 1) return;
            const touch = e.touches[0];
            const deltaX = touch.clientX - lastPos.current.x;
            const deltaY = touch.clientY - lastPos.current.y;
            dispatch(setPan({ x: panX + deltaX, y: panY + deltaY }));
            lastPos.current = { x: touch.clientX, y: touch.clientY };
        },
        [isDragging, dispatch, panX, panY]
    );

    const handleTouchEnd = useCallback(() => {
        setIsDragging(false);
    }, []);

    // Double-click to reset view
    const handleDoubleClick = useCallback(() => {
        dispatch(setZoom(1));
        dispatch(setPan({ x: 0, y: 0 }));
    }, [dispatch]);

    // Reset state when file changes
    useEffect(() => {
        // eslint-disable-next-line react-hooks/set-state-in-effect -- resetting state when file.id changes is valid
        setImageLoaded(false);
        dispatch(setViewerLoading(true));
    }, [file.id, dispatch]);

    // Show loading spinner while fetching file
    if (downloadLoading) {
        return (
            <div className="viewer-loading">
                <Spinner size={48} className="animate-spin" />
            </div>
        );
    }

    // Show error message
    if (downloadError || !imageUrl) {
        return (
            <div className="viewer-error">
                <p>{downloadError || 'Unable to load image'}</p>
            </div>
        );
    }

    return (
        <div
            ref={containerRef}
            className="w-full h-full flex items-center justify-center overflow-hidden cursor-grab active:cursor-grabbing select-none p-4"
            onMouseDown={handleMouseDown}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseLeave}
            onMouseMove={handleMouseMove}
            onTouchStart={handleTouchStart}
            onTouchMove={handleTouchMove}
            onTouchEnd={handleTouchEnd}
            onDoubleClick={handleDoubleClick}
        >
            {/* Loading indicator */}
            {loading && !imageLoaded && (
                <div className="absolute inset-0 flex items-center justify-center">
                    <div className="animate-pulse w-12 h-12 rounded-full bg-white/10" />
                </div>
            )}

            <img
                src={imageUrl}
                alt={file.filename}
                className="select-none"
                style={{
                    // At zoom=1, image fits naturally within container
                    // max-width/max-height ensure it never overflows
                    maxWidth: zoom === 1 && panX === 0 && panY === 0 ? '100%' : 'none',
                    maxHeight: zoom === 1 && panX === 0 && panY === 0 ? '100%' : 'none',
                    objectFit: 'contain',
                    // Apply transforms for zoom, pan, and rotation
                    transform: `translate(${panX}px, ${panY}px) scale(${zoom}) rotate(${rotation}deg)`,
                    transformOrigin: 'center center',
                    transition: isDragging ? 'none' : 'transform 0.15s ease-out',
                    opacity: imageLoaded ? 1 : 0,
                }}
                draggable={false}
                onLoad={handleImageLoad}
                onError={handleImageError}
            />
        </div>
    );
}
