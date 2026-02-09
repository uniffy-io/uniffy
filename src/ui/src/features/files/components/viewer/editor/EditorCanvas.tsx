/**
 * Editor Canvas Component
 *
 * Canvas-based image display with transform preview.
 * Renders the image with all transforms applied using CSS for performance.
 * The actual canvas manipulation happens during export.
 */

import { useState, useRef, useEffect, useCallback } from 'react';
import { Spinner } from '@phosphor-icons/react';
import { CropOverlay } from '@/features/files/components/viewer/editor/CropOverlay';
import type { CropRect } from '@/features/files/store/imageEditorSlice';

interface EditorCanvasProps {
    /** Image URL to display */
    imageUrl: string | null;
    /** Whether image is loading */
    loading: boolean;
    /** Rotation in degrees (0, 90, 180, 270) */
    rotation: number;
    /** Horizontal flip */
    flipH: boolean;
    /** Vertical flip */
    flipV: boolean;
    /** Brightness adjustment (-100 to 100) */
    brightness: number;
    /** Contrast adjustment (-100 to 100) */
    contrast: number;
    /** Whether crop tool is active */
    cropActive: boolean;
    /** Current crop rectangle */
    cropRect: CropRect | null;
    /** Whether crop has been applied */
    isCropped: boolean;
    /** Callback when crop rectangle changes */
    onCropChange: (rect: CropRect | null) => void;
}

export function EditorCanvas({
    imageUrl,
    loading,
    rotation,
    flipH,
    flipV,
    brightness,
    contrast,
    cropActive,
    cropRect,
    onCropChange,
}: EditorCanvasProps) {
    const imageRef = useRef<HTMLImageElement>(null);
    const [imageLoaded, setImageLoaded] = useState(false);
    const [imageDimensions, setImageDimensions] = useState({ width: 0, height: 0 });
    const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });

    // Track container size - use a callback ref to handle when container becomes available
    const [containerElement, setContainerElement] = useState<HTMLDivElement | null>(null);

    const containerRefCallback = useCallback((node: HTMLDivElement | null) => {
        setContainerElement(node);
    }, []);

    useEffect(() => {
        if (!containerElement) return;

        // Initial size
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setContainerSize({
            width: containerElement.clientWidth,
            height: containerElement.clientHeight,
        });

        const observer = new ResizeObserver(() => {
            setContainerSize({
                width: containerElement.clientWidth,
                height: containerElement.clientHeight,
            });
        });

        observer.observe(containerElement);
        return () => observer.disconnect();
    }, [containerElement]);

    // Handle image load
    const handleImageLoad = useCallback(() => {
        if (imageRef.current) {
            setImageDimensions({
                width: imageRef.current.naturalWidth,
                height: imageRef.current.naturalHeight,
            });
            setImageLoaded(true);
        }
    }, []);

    // Reset loaded state when image changes
    useEffect(() => {
        // eslint-disable-next-line react-hooks/set-state-in-effect -- resetting state when imageUrl changes is valid
        setImageLoaded(false);
    }, [imageUrl]);

    // Calculate display dimensions to fit container while maintaining aspect ratio
    const calculateDisplayDimensions = useCallback(() => {
        if (!imageDimensions.width || !imageDimensions.height || !containerSize.width || !containerSize.height) {
            return { width: 0, height: 0, offsetX: 0, offsetY: 0 };
        }

        // For 90/270 rotations, swap the image dimensions for calculation
        const isRotated = rotation === 90 || rotation === 270;
        const imgWidth = isRotated ? imageDimensions.height : imageDimensions.width;
        const imgHeight = isRotated ? imageDimensions.width : imageDimensions.height;

        // Use 90% of container to leave some padding
        const maxWidth = containerSize.width * 0.9;
        const maxHeight = containerSize.height * 0.9;

        const widthRatio = maxWidth / imgWidth;
        const heightRatio = maxHeight / imgHeight;
        const scale = Math.min(widthRatio, heightRatio, 1);

        const displayWidth = imgWidth * scale;
        const displayHeight = imgHeight * scale;

        // Center in container
        const offsetX = (containerSize.width - displayWidth) / 2;
        const offsetY = (containerSize.height - displayHeight) / 2;

        return { width: displayWidth, height: displayHeight, offsetX, offsetY };
    }, [imageDimensions, containerSize, rotation]);

    const displayDims = calculateDisplayDimensions();

    // Calculate CSS filter string
    const filter = `brightness(${100 + brightness}%) contrast(${100 + contrast}%)`;

    // Calculate CSS transform string
    const transforms: string[] = [];

    if (rotation !== 0) {
        transforms.push(`rotate(${rotation}deg)`);
    }

    if (flipH || flipV) {
        const scaleX = flipH ? -1 : 1;
        const scaleY = flipV ? -1 : 1;
        transforms.push(`scale(${scaleX}, ${scaleY})`);
    }

    const transform = transforms.length > 0 ? transforms.join(' ') : undefined;

    // Show loading state
    if (loading || !imageUrl) {
        console.log('[EditorCanvas] Showing loading spinner');
        return (
            <div className="flex-1 flex items-center justify-center">
                <Spinner size={48} className="animate-spin text-white/50" />
            </div>
        );
    }

    return (
        <div
            ref={containerRefCallback}
            className="flex-1 relative overflow-hidden bg-black/20"
        >
            {/* Image container with transforms */}
            <div
                className="absolute"
                style={{
                    left: displayDims.offsetX,
                    top: displayDims.offsetY,
                    width: displayDims.width,
                    height: displayDims.height,
                }}
            >
                {/* The actual image with CSS transforms for preview */}
                <img
                    ref={imageRef}
                    src={imageUrl}
                    alt="Editor preview"
                    className="w-full h-full object-contain select-none pointer-events-none"
                    style={{
                        filter,
                        transform,
                        transformOrigin: 'center center',
                        opacity: imageLoaded ? 1 : 0,
                        transition: 'opacity 0.2s ease-out',
                    }}
                    onLoad={handleImageLoad}
                    onError={() => {}}
                    draggable={false}
                />

                {/* Crop overlay - positioned over the image */}
                {imageLoaded && (
                    <CropOverlay
                        containerWidth={displayDims.width}
                        containerHeight={displayDims.height}
                        cropRect={cropRect}
                        onCropChange={onCropChange}
                        isActive={cropActive}
                    />
                )}
            </div>

            {/* Loading indicator for image */}
            {!imageLoaded && (
                <div className="absolute inset-0 flex items-center justify-center">
                    <div className="animate-pulse w-12 h-12 rounded-full bg-white/10" />
                </div>
            )}
        </div>
    );
}
