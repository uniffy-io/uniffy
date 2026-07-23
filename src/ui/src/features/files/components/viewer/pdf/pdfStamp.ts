import { PDFDocument, StandardFonts, degrees, rgb } from 'pdf-lib';
import type { PdfWatermark } from '@/features/files/store/viewerSlice';

const WATERMARK_COLOR = rgb(0.45, 0.45, 0.45);

function clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
}

/** Bakes a diagonal text watermark onto every page of a copy of the source document. */
export async function buildWatermarkedPdf(
    sourceBytes: ArrayBuffer | Uint8Array,
    watermark: PdfWatermark
): Promise<Blob> {
    const text = watermark.text.trim();
    if (!text) throw new Error('Watermark text is empty');

    const doc = await PDFDocument.load(sourceBytes);
    const font = await doc.embedFont(StandardFonts.Helvetica);

    for (const page of doc.getPages()) {
        const { width, height } = page.getSize();
        const size = clamp((width * 1.4) / text.length, 24, 96);
        const textWidth = font.widthOfTextAtSize(text, size);
        // Rotation happens around the text origin; offset by the projected
        // half-width so the 45-degree run stays visually centered.
        page.drawText(text, {
            x: width / 2 - (textWidth / 2) * Math.SQRT1_2,
            y: height / 2 - (textWidth / 2) * Math.SQRT1_2,
            size,
            font,
            color: WATERMARK_COLOR,
            opacity: watermark.opacity,
            rotate: degrees(45),
        });
    }

    const bytes = await doc.save();
    return new Blob([new Uint8Array(bytes)], { type: 'application/pdf' });
}
