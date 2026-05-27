import { useState, useRef, useCallback, useEffect } from 'react';
import { cn } from '@/shared/utils/cn';
import type { CropRect } from '@/features/files/store/imageEditorSlice';

interface CropOverlayProps {
    /** Container width */
    containerWidth: number;
    /** Container height */
    containerHeight: number;
    /** Current crop rectangle */
    cropRect: CropRect | null;
    /** Callback when crop rect changes */
    onCropChange: (rect: CropRect | null) => void;
    /** Whether crop mode is active */
    isActive: boolean;
}

type ResizeHandle =
    | 'nw'
    | 'n'
    | 'ne'
    | 'e'
    | 'se'
    | 's'
    | 'sw'
    | 'w'
    | 'move';

const MIN_CROP_SIZE = 20;

export function CropOverlay({
    containerWidth,
    containerHeight,
    cropRect,
    onCropChange,
    isActive,
}: CropOverlayProps) {
    const [isDragging, setIsDragging] = useState(false);
    const [dragHandle, setDragHandle] = useState<ResizeHandle | null>(null);
    const [startPos, setStartPos] = useState({ x: 0, y: 0 });
    const [startRect, setStartRect] = useState<CropRect | null>(null);
    const overlayRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (isActive && !cropRect && containerWidth > 0 && containerHeight > 0) {
            // Start with a centered rectangle covering 80% of the image
            const width = Math.round(containerWidth * 0.8);
            const height = Math.round(containerHeight * 0.8);
            const x = Math.round((containerWidth - width) / 2);
            const y = Math.round((containerHeight - height) / 2);
            onCropChange({ x, y, width, height });
        }
    }, [isActive, cropRect, containerWidth, containerHeight, onCropChange]);

    const handleOverlayMouseDown = useCallback(
        (e: React.MouseEvent) => {
            if (!isActive || !overlayRef.current) return;

            const rect = overlayRef.current.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const y = e.clientY - rect.top;

            // Start new selection
            setIsDragging(true);
            setDragHandle(null);
            setStartPos({ x, y });
            setStartRect(null);
            onCropChange({ x, y, width: 0, height: 0 });
        },
        [isActive, onCropChange]
    );

    const handleHandleMouseDown = useCallback(
        (e: React.MouseEvent, handle: ResizeHandle) => {
            e.stopPropagation();
            if (!cropRect) return;

            setIsDragging(true);
            setDragHandle(handle);
            setStartPos({ x: e.clientX, y: e.clientY });
            setStartRect({ ...cropRect });
        },
        [cropRect]
    );

    useEffect(() => {
        if (!isDragging) return;

        const handleMouseMove = (e: MouseEvent) => {
            if (!overlayRef.current) return;

            const rect = overlayRef.current.getBoundingClientRect();

            if (dragHandle === null) {
                // Drawing new selection
                const currentX = Math.max(0, Math.min(e.clientX - rect.left, containerWidth));
                const currentY = Math.max(0, Math.min(e.clientY - rect.top, containerHeight));

                const newRect: CropRect = {
                    x: Math.min(startPos.x, currentX),
                    y: Math.min(startPos.y, currentY),
                    width: Math.abs(currentX - startPos.x),
                    height: Math.abs(currentY - startPos.y),
                };

                onCropChange(newRect);
            } else if (startRect) {
                // Resizing or moving existing selection
                const deltaX = e.clientX - startPos.x;
                const deltaY = e.clientY - startPos.y;

                const newRect = { ...startRect };

                switch (dragHandle) {
                    case 'move':
                        newRect.x = Math.max(
                            0,
                            Math.min(startRect.x + deltaX, containerWidth - startRect.width)
                        );
                        newRect.y = Math.max(
                            0,
                            Math.min(startRect.y + deltaY, containerHeight - startRect.height)
                        );
                        break;
                    case 'nw':
                        newRect.x = Math.max(0, startRect.x + deltaX);
                        newRect.y = Math.max(0, startRect.y + deltaY);
                        newRect.width = Math.max(MIN_CROP_SIZE, startRect.width - deltaX);
                        newRect.height = Math.max(MIN_CROP_SIZE, startRect.height - deltaY);
                        break;
                    case 'n':
                        newRect.y = Math.max(0, startRect.y + deltaY);
                        newRect.height = Math.max(MIN_CROP_SIZE, startRect.height - deltaY);
                        break;
                    case 'ne':
                        newRect.y = Math.max(0, startRect.y + deltaY);
                        newRect.width = Math.max(MIN_CROP_SIZE, startRect.width + deltaX);
                        newRect.height = Math.max(MIN_CROP_SIZE, startRect.height - deltaY);
                        break;
                    case 'e':
                        newRect.width = Math.max(MIN_CROP_SIZE, startRect.width + deltaX);
                        break;
                    case 'se':
                        newRect.width = Math.max(MIN_CROP_SIZE, startRect.width + deltaX);
                        newRect.height = Math.max(MIN_CROP_SIZE, startRect.height + deltaY);
                        break;
                    case 's':
                        newRect.height = Math.max(MIN_CROP_SIZE, startRect.height + deltaY);
                        break;
                    case 'sw':
                        newRect.x = Math.max(0, startRect.x + deltaX);
                        newRect.width = Math.max(MIN_CROP_SIZE, startRect.width - deltaX);
                        newRect.height = Math.max(MIN_CROP_SIZE, startRect.height + deltaY);
                        break;
                    case 'w':
                        newRect.x = Math.max(0, startRect.x + deltaX);
                        newRect.width = Math.max(MIN_CROP_SIZE, startRect.width - deltaX);
                        break;
                }

                // Clamp to container bounds
                newRect.x = Math.max(0, Math.min(newRect.x, containerWidth - MIN_CROP_SIZE));
                newRect.y = Math.max(0, Math.min(newRect.y, containerHeight - MIN_CROP_SIZE));
                newRect.width = Math.min(newRect.width, containerWidth - newRect.x);
                newRect.height = Math.min(newRect.height, containerHeight - newRect.y);

                onCropChange(newRect);
            }
        };

        const handleMouseUp = () => {
            setIsDragging(false);
            setDragHandle(null);
            setStartRect(null);
        };

        window.addEventListener('mousemove', handleMouseMove);
        window.addEventListener('mouseup', handleMouseUp);

        return () => {
            window.removeEventListener('mousemove', handleMouseMove);
            window.removeEventListener('mouseup', handleMouseUp);
        };
    }, [
        isDragging,
        dragHandle,
        startPos,
        startRect,
        containerWidth,
        containerHeight,
        onCropChange,
    ]);

    if (!isActive) return null;

    const hasSelection = cropRect && cropRect.width > 0 && cropRect.height > 0;

    return (
        <div
            ref={overlayRef}
            className="absolute inset-0 cursor-crosshair"
            onMouseDown={handleOverlayMouseDown}
            style={{ width: containerWidth, height: containerHeight }}
        >
            {/* Dimmed overlay areas */}
            {hasSelection && cropRect && (
                <>
                    {/* Top */}
                    <div
                        className="absolute bg-black/60"
                        style={{
                            top: 0,
                            left: 0,
                            right: 0,
                            height: cropRect.y,
                        }}
                    />
                    {/* Bottom */}
                    <div
                        className="absolute bg-black/60"
                        style={{
                            top: cropRect.y + cropRect.height,
                            left: 0,
                            right: 0,
                            bottom: 0,
                        }}
                    />
                    {/* Left */}
                    <div
                        className="absolute bg-black/60"
                        style={{
                            top: cropRect.y,
                            left: 0,
                            width: cropRect.x,
                            height: cropRect.height,
                        }}
                    />
                    {/* Right */}
                    <div
                        className="absolute bg-black/60"
                        style={{
                            top: cropRect.y,
                            left: cropRect.x + cropRect.width,
                            right: 0,
                            height: cropRect.height,
                        }}
                    />
                </>
            )}

            {/* Crop selection box */}
            {hasSelection && cropRect && (
                <div
                    className="absolute border-2 border-white shadow-lg"
                    style={{
                        left: cropRect.x,
                        top: cropRect.y,
                        width: cropRect.width,
                        height: cropRect.height,
                    }}
                    onMouseDown={(e) => handleHandleMouseDown(e, 'move')}
                >
                    {/* Rule of thirds grid */}
                    <div className="absolute inset-0 pointer-events-none">
                        <div
                            className="absolute bg-white/30"
                            style={{ left: '33.33%', top: 0, bottom: 0, width: 1 }}
                        />
                        <div
                            className="absolute bg-white/30"
                            style={{ left: '66.66%', top: 0, bottom: 0, width: 1 }}
                        />
                        <div
                            className="absolute bg-white/30"
                            style={{ top: '33.33%', left: 0, right: 0, height: 1 }}
                        />
                        <div
                            className="absolute bg-white/30"
                            style={{ top: '66.66%', left: 0, right: 0, height: 1 }}
                        />
                    </div>

                    {/* Resize handles */}
                    <ResizeHandles onHandleMouseDown={handleHandleMouseDown} />

                    {/* Dimensions display */}
                    <div className="absolute -bottom-7 left-1/2 -translate-x-1/2 bg-black/80 text-white text-xs px-2 py-0.5 rounded whitespace-nowrap">
                        {Math.round(cropRect.width)} x {Math.round(cropRect.height)}
                    </div>
                </div>
            )}
        </div>
    );
}

interface ResizeHandlesProps {
    onHandleMouseDown: (e: React.MouseEvent, handle: ResizeHandle) => void;
}

function ResizeHandles({ onHandleMouseDown }: ResizeHandlesProps) {
    const handleClass =
        'absolute w-3 h-3 bg-white border border-gray-400 rounded-sm shadow';

    return (
        <>
            {/* Corner handles */}
            <div
                className={cn(handleClass, '-top-1.5 -left-1.5 cursor-nw-resize')}
                onMouseDown={(e) => onHandleMouseDown(e, 'nw')}
            />
            <div
                className={cn(handleClass, '-top-1.5 -right-1.5 cursor-ne-resize')}
                onMouseDown={(e) => onHandleMouseDown(e, 'ne')}
            />
            <div
                className={cn(handleClass, '-bottom-1.5 -left-1.5 cursor-sw-resize')}
                onMouseDown={(e) => onHandleMouseDown(e, 'sw')}
            />
            <div
                className={cn(handleClass, '-bottom-1.5 -right-1.5 cursor-se-resize')}
                onMouseDown={(e) => onHandleMouseDown(e, 'se')}
            />

            {/* Edge handles */}
            <div
                className={cn(handleClass, '-top-1.5 left-1/2 -translate-x-1/2 cursor-n-resize')}
                onMouseDown={(e) => onHandleMouseDown(e, 'n')}
            />
            <div
                className={cn(handleClass, '-bottom-1.5 left-1/2 -translate-x-1/2 cursor-s-resize')}
                onMouseDown={(e) => onHandleMouseDown(e, 's')}
            />
            <div
                className={cn(handleClass, 'top-1/2 -left-1.5 -translate-y-1/2 cursor-w-resize')}
                onMouseDown={(e) => onHandleMouseDown(e, 'w')}
            />
            <div
                className={cn(handleClass, 'top-1/2 -right-1.5 -translate-y-1/2 cursor-e-resize')}
                onMouseDown={(e) => onHandleMouseDown(e, 'e')}
            />
        </>
    );
}
