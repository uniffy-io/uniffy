import type { PdfDocumentInfo } from "@/features/files/store/viewerSlice";
import { formatDateFull, formatFileSize } from "@/shared/utils/dateFormatting";

/**
 * Parses PDF date strings like `D:20260115093000+02'00'`. Trailing timezone
 * offsets are ignored; the timestamp is interpreted as local time.
 */
export function parsePdfDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const match = /^D:(\d{4})(\d{2})?(\d{2})?(\d{2})?(\d{2})?(\d{2})?/.exec(value.trim());
  if (!match) return null;
  const [, year, month = "01", day = "01", hour = "00", minute = "00", second = "00"] = match;
  const monthNum = Number(month);
  const dayNum = Number(day);
  if (monthNum < 1 || monthNum > 12 || dayNum < 1 || dayNum > 31) return null;
  const date = new Date(
    Number(year),
    monthNum - 1,
    dayNum,
    Number(hour),
    Number(minute),
    Number(second),
  );
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Shapes pdf.js `getMetadata().info` into the serializable slice payload. */
export function extractPdfDocumentInfo(info: unknown): PdfDocumentInfo {
  const record = (typeof info === "object" && info !== null ? info : {}) as Record<string, unknown>;
  const stringField = (key: string): string | undefined => {
    const value = record[key];
    return typeof value === "string" && value.trim() ? value.trim() : undefined;
  };
  const created = parsePdfDate(
    typeof record.CreationDate === "string" ? record.CreationDate : null,
  );
  return {
    title: stringField("Title"),
    author: stringField("Author"),
    createdAt: created ? created.toISOString() : undefined,
    producer: stringField("Producer"),
    formatVersion: stringField("PDFFormatVersion"),
  };
}

export interface PdfInfoRow {
  label: string;
  value: string;
}

/** Display rows for the info popover; absent metadata fields are omitted entirely. */
export function buildPdfInfoRows(
  info: PdfDocumentInfo | null,
  numPages: number,
  sizeBytes: number,
): PdfInfoRow[] {
  const rows: PdfInfoRow[] = [];
  if (info?.title) rows.push({ label: "Title", value: info.title });
  if (info?.author) rows.push({ label: "Author", value: info.author });
  if (info?.createdAt) rows.push({ label: "Created", value: formatDateFull(info.createdAt) });
  if (info?.producer) rows.push({ label: "Producer", value: info.producer });
  if (info?.formatVersion) rows.push({ label: "PDF version", value: info.formatVersion });
  if (numPages > 0) rows.push({ label: "Pages", value: String(numPages) });
  if (sizeBytes > 0) rows.push({ label: "Size", value: formatFileSize(sizeBytes) });
  return rows;
}
