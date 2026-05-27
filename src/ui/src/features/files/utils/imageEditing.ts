/** Brightness in [-100, 100], applied in-place per RGB channel (alpha untouched). */
export function applyBrightness(imageData: ImageData, value: number): void {
    const factor = (value / 100) * 255;
    const data = imageData.data;

    for (let i = 0; i < data.length; i += 4) {
        data[i] = Math.max(0, Math.min(255, data[i] + factor));
        data[i + 1] = Math.max(0, Math.min(255, data[i + 1] + factor));
        data[i + 2] = Math.max(0, Math.min(255, data[i + 2] + factor));
    }
}

/** Contrast in [-100, 100]; factor curve from the canonical -100=0, 0=1, 100=~2 mapping. */
export function applyContrast(imageData: ImageData, value: number): void {
    const factor = (259 * (value + 255)) / (255 * (259 - value));
    const data = imageData.data;

    for (let i = 0; i < data.length; i += 4) {
        data[i] = Math.max(0, Math.min(255, factor * (data[i] - 128) + 128));
        data[i + 1] = Math.max(0, Math.min(255, factor * (data[i + 1] - 128) + 128));
        data[i + 2] = Math.max(0, Math.min(255, factor * (data[i + 2] - 128) + 128));
    }
}

export interface CropRect {
    x: number;
    y: number;
    width: number;
    height: number;
}

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

export function rotateCanvas(sourceCanvas: HTMLCanvasElement, degrees: number): HTMLCanvasElement {
    const normalizedDegrees = ((degrees % 360) + 360) % 360;

    const rotatedCanvas = document.createElement('canvas');
    const ctx = rotatedCanvas.getContext('2d');
    if (!ctx) {
        throw new Error('Failed to get canvas context');
    }

    if (normalizedDegrees === 90 || normalizedDegrees === 270) {
        rotatedCanvas.width = sourceCanvas.height;
        rotatedCanvas.height = sourceCanvas.width;
    } else {
        rotatedCanvas.width = sourceCanvas.width;
        rotatedCanvas.height = sourceCanvas.height;
    }

    ctx.save();

    ctx.translate(rotatedCanvas.width / 2, rotatedCanvas.height / 2);
    ctx.rotate((normalizedDegrees * Math.PI) / 180);
    ctx.drawImage(sourceCanvas, -sourceCanvas.width / 2, -sourceCanvas.height / 2);

    ctx.restore();

    return rotatedCanvas;
}

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

/** Uses ctx.filter (CSS) which is much cheaper than per-pixel work for live preview. */
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

    const brightnessPercent = 100 + brightness;
    const contrastPercent = 100 + contrast;

    ctx.filter = `brightness(${brightnessPercent}%) contrast(${contrastPercent}%)`;
    ctx.drawImage(sourceCanvas, 0, 0);
    ctx.filter = 'none';

    return adjustedCanvas;
}

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

    // Crop must precede rotation/flip so the rect maps to source coordinates.
    if (options.cropRect) {
        result = cropCanvas(result, options.cropRect);
    }

    if (options.rotation !== 0) {
        result = rotateCanvas(result, options.rotation);
    }

    if (options.flipH) {
        result = flipCanvas(result, true);
    }
    if (options.flipV) {
        result = flipCanvas(result, false);
    }

    if (options.brightness !== 0 || options.contrast !== 0) {
        result = applyAdjustmentsCanvas(result, options.brightness, options.contrast);
    }

    return result;
}

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

export function getCssFilter(brightness: number, contrast: number): string {
    const brightnessPercent = 100 + brightness;
    const contrastPercent = 100 + contrast;
    return `brightness(${brightnessPercent}%) contrast(${contrastPercent}%)`;
}

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
