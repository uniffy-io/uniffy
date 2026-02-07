/**
 * Image Editing Utility Functions
 *
 * Pure functions for image processing operations.
 * These operate on canvas ImageData or handle canvas transformations.
 */

/**
 * Apply brightness adjustment to image data.
 *
 * @param imageData - The ImageData to modify (in-place)
 * @param value - Brightness value (-100 to 100)
 */
export function applyBrightness(imageData: ImageData, value: number): void {
    const factor = (value / 100) * 255;
    const data = imageData.data;

    for (let i = 0; i < data.length; i += 4) {
        data[i] = Math.max(0, Math.min(255, data[i] + factor)); // R
        data[i + 1] = Math.max(0, Math.min(255, data[i + 1] + factor)); // G
        data[i + 2] = Math.max(0, Math.min(255, data[i + 2] + factor)); // B
        // Alpha (data[i + 3]) unchanged
    }
}

/**
 * Apply contrast adjustment to image data.
 *
 * @param imageData - The ImageData to modify (in-place)
 * @param value - Contrast value (-100 to 100)
 */
export function applyContrast(imageData: ImageData, value: number): void {
    // Convert -100..100 to a factor
    // At 0, factor = 1 (no change)
    // At 100, factor = ~2 (high contrast)
    // At -100, factor = ~0 (low contrast)
    const factor = (259 * (value + 255)) / (255 * (259 - value));
    const data = imageData.data;

    for (let i = 0; i < data.length; i += 4) {
        data[i] = Math.max(0, Math.min(255, factor * (data[i] - 128) + 128)); // R
        data[i + 1] = Math.max(0, Math.min(255, factor * (data[i + 1] - 128) + 128)); // G
        data[i + 2] = Math.max(0, Math.min(255, factor * (data[i + 2] - 128) + 128)); // B
    }
}

/**
 * Crop rectangle definition.
 */
export interface CropRect {
    x: number;
    y: number;
    width: number;
    height: number;
}

/**
 * Crop an image using canvas.
 *
 * @param sourceCanvas - The source canvas
 * @param rect - The crop rectangle
 * @returns A new canvas with the cropped image
 */
export function cropCanvas(sourceCanvas: HTMLCanvasElement, rect: CropRect): HTMLCanvasElement {
    const croppedCanvas = document.createElement('canvas');
    croppedCanvas.width = rect.width;
    croppedCanvas.height = rect.height;

    const ctx = croppedCanvas.getContext('2d');
    if (!ctx) {
        throw new Error('Failed to get canvas context');
    }

    ctx.drawImage(
        sourceCanvas,
        rect.x,
        rect.y,
        rect.width,
        rect.height,
        0,
        0,
        rect.width,
        rect.height
    );

    return croppedCanvas;
}

/**
 * Rotate a canvas by the specified degrees.
 *
 * @param sourceCanvas - The source canvas
 * @param degrees - Rotation angle (0, 90, 180, 270)
 * @returns A new canvas with the rotated image
 */
export function rotateCanvas(sourceCanvas: HTMLCanvasElement, degrees: number): HTMLCanvasElement {
    const normalizedDegrees = ((degrees % 360) + 360) % 360;

    const rotatedCanvas = document.createElement('canvas');
    const ctx = rotatedCanvas.getContext('2d');
    if (!ctx) {
        throw new Error('Failed to get canvas context');
    }

    // Swap dimensions for 90/270 degree rotations
    if (normalizedDegrees === 90 || normalizedDegrees === 270) {
        rotatedCanvas.width = sourceCanvas.height;
        rotatedCanvas.height = sourceCanvas.width;
    } else {
        rotatedCanvas.width = sourceCanvas.width;
        rotatedCanvas.height = sourceCanvas.height;
    }

    ctx.save();

    // Move to center, rotate, then draw
    ctx.translate(rotatedCanvas.width / 2, rotatedCanvas.height / 2);
    ctx.rotate((normalizedDegrees * Math.PI) / 180);
    ctx.drawImage(sourceCanvas, -sourceCanvas.width / 2, -sourceCanvas.height / 2);

    ctx.restore();

    return rotatedCanvas;
}

/**
 * Flip a canvas horizontally or vertically.
 *
 * @param sourceCanvas - The source canvas
 * @param horizontal - True to flip horizontally, false for vertical
 * @returns A new canvas with the flipped image
 */
export function flipCanvas(sourceCanvas: HTMLCanvasElement, horizontal: boolean): HTMLCanvasElement {
    const flippedCanvas = document.createElement('canvas');
    flippedCanvas.width = sourceCanvas.width;
    flippedCanvas.height = sourceCanvas.height;

    const ctx = flippedCanvas.getContext('2d');
    if (!ctx) {
        throw new Error('Failed to get canvas context');
    }

    ctx.save();

    if (horizontal) {
        ctx.translate(flippedCanvas.width, 0);
        ctx.scale(-1, 1);
    } else {
        ctx.translate(0, flippedCanvas.height);
        ctx.scale(1, -1);
    }

    ctx.drawImage(sourceCanvas, 0, 0);
    ctx.restore();

    return flippedCanvas;
}

/**
 * Apply brightness and contrast to a canvas using CSS filters.
 * Note: This method uses CSS filters which are more performant for preview.
 *
 * @param sourceCanvas - The source canvas
 * @param brightness - Brightness value (-100 to 100)
 * @param contrast - Contrast value (-100 to 100)
 * @returns A new canvas with adjustments applied
 */
export function applyAdjustmentsCanvas(
    sourceCanvas: HTMLCanvasElement,
    brightness: number,
    contrast: number
): HTMLCanvasElement {
    const adjustedCanvas = document.createElement('canvas');
    adjustedCanvas.width = sourceCanvas.width;
    adjustedCanvas.height = sourceCanvas.height;

    const ctx = adjustedCanvas.getContext('2d');
    if (!ctx) {
        throw new Error('Failed to get canvas context');
    }

    // Convert values to CSS filter format
    // brightness: 0% to 200% (100% = no change)
    // contrast: 0% to 200% (100% = no change)
    const brightnessPercent = 100 + brightness;
    const contrastPercent = 100 + contrast;

    ctx.filter = `brightness(${brightnessPercent}%) contrast(${contrastPercent}%)`;
    ctx.drawImage(sourceCanvas, 0, 0);
    ctx.filter = 'none';

    return adjustedCanvas;
}

/**
 * Load an image from a URL into a canvas.
 *
 * @param imageUrl - The image URL (blob URL or data URL)
 * @returns Promise resolving to a canvas with the image
 */
export async function loadImageToCanvas(imageUrl: string): Promise<HTMLCanvasElement> {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.crossOrigin = 'anonymous';

        img.onload = () => {
            const canvas = document.createElement('canvas');
            canvas.width = img.naturalWidth;
            canvas.height = img.naturalHeight;

            const ctx = canvas.getContext('2d');
            if (!ctx) {
                reject(new Error('Failed to get canvas context'));
                return;
            }

            ctx.drawImage(img, 0, 0);
            resolve(canvas);
        };

        img.onerror = () => {
            reject(new Error('Failed to load image'));
        };

        img.src = imageUrl;
    });
}

/**
 * Apply all transforms to a canvas.
 *
 * @param sourceCanvas - The source canvas
 * @param options - Transform options
 * @returns A new canvas with all transforms applied
 */
export interface TransformOptions {
    rotation: number;
    flipH: boolean;
    flipV: boolean;
    brightness: number;
    contrast: number;
    cropRect?: CropRect | null;
}

export function applyAllTransforms(
    sourceCanvas: HTMLCanvasElement,
    options: TransformOptions
): HTMLCanvasElement {
    let result = sourceCanvas;

    // Apply crop first (if any)
    if (options.cropRect) {
        result = cropCanvas(result, options.cropRect);
    }

    // Apply rotation
    if (options.rotation !== 0) {
        result = rotateCanvas(result, options.rotation);
    }

    // Apply flips
    if (options.flipH) {
        result = flipCanvas(result, true);
    }
    if (options.flipV) {
        result = flipCanvas(result, false);
    }

    // Apply brightness/contrast
    if (options.brightness !== 0 || options.contrast !== 0) {
        result = applyAdjustmentsCanvas(result, options.brightness, options.contrast);
    }

    return result;
}

/**
 * Export canvas to a Blob.
 *
 * @param canvas - The canvas to export
 * @param mimeType - Output MIME type ('image/png' or 'image/jpeg')
 * @param quality - JPEG quality (0-1), ignored for PNG
 * @returns Promise resolving to Blob
 */
export async function exportCanvasToBlob(
    canvas: HTMLCanvasElement,
    mimeType: 'image/png' | 'image/jpeg' = 'image/png',
    quality: number = 0.92
): Promise<Blob> {
    return new Promise((resolve, reject) => {
        canvas.toBlob(
            (blob) => {
                if (blob) {
                    resolve(blob);
                } else {
                    reject(new Error('Failed to export canvas to blob'));
                }
            },
            mimeType,
            quality
        );
    });
}

/**
 * Get CSS filter string for preview rendering.
 * Uses CSS filters for better performance during live preview.
 *
 * @param brightness - Brightness value (-100 to 100)
 * @param contrast - Contrast value (-100 to 100)
 * @returns CSS filter string
 */
export function getCssFilter(brightness: number, contrast: number): string {
    const brightnessPercent = 100 + brightness;
    const contrastPercent = 100 + contrast;
    return `brightness(${brightnessPercent}%) contrast(${contrastPercent}%)`;
}

/**
 * Get CSS transform string for preview rendering.
 *
 * @param rotation - Rotation in degrees
 * @param flipH - Horizontal flip
 * @param flipV - Vertical flip
 * @param scale - Scale factor (default 1)
 * @returns CSS transform string
 */
export function getCssTransform(
    rotation: number,
    flipH: boolean,
    flipV: boolean,
    scale: number = 1
): string {
    const transforms: string[] = [];

    if (scale !== 1) {
        transforms.push(`scale(${scale})`);
    }

    if (rotation !== 0) {
        transforms.push(`rotate(${rotation}deg)`);
    }

    if (flipH || flipV) {
        const scaleX = flipH ? -1 : 1;
        const scaleY = flipV ? -1 : 1;
        transforms.push(`scale(${scaleX}, ${scaleY})`);
    }

    return transforms.length > 0 ? transforms.join(' ') : 'none';
}
