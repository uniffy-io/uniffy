import { downloadBlob } from "@/shared/utils/download";

const ICALENDAR_MIME_TYPE = "text/calendar;charset=utf-8";

/** Hand an iCalendar document to the browser as a file. */
export function downloadIcs(content: Uint8Array, filename: string): void {
  // Copy into a plain ArrayBuffer: a Uint8Array can be backed by a
  // SharedArrayBuffer, which Blob does not accept.
  const bytes = new Uint8Array(content);
  downloadBlob(new Blob([bytes.buffer as ArrayBuffer], { type: ICALENDAR_MIME_TYPE }), filename);
}
