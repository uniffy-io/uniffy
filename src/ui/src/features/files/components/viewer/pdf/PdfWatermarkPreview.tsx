import { useAppSelector } from "@/app/hooks";

interface PdfWatermarkPreviewProps {
  /** Rendered page width in CSS px; sizes the preview text. */
  pageWidth: number | undefined;
}

/** Per-page preview of the pending watermark; purely visual, never interactive. */
export function PdfWatermarkPreview({ pageWidth }: PdfWatermarkPreviewProps) {
  const watermark = useAppSelector((state) => state.fileViewer.pdfWatermark);
  const text = watermark?.text.trim();
  if (!text) return null;

  const fontSize = Math.max(16, Math.min(120, ((pageWidth ?? 600) * 1.4) / text.length));

  return (
    <div className="viewer-pdf-watermark-layer">
      <span
        className="viewer-pdf-watermark-preview"
        style={{ fontSize, opacity: watermark?.opacity ?? 0.2 }}
      >
        {text}
      </span>
    </div>
  );
}
