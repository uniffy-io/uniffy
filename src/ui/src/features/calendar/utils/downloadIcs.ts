const ICALENDAR_MIME_TYPE = "text/calendar;charset=utf-8";

/**
 * Hand an iCalendar document to the browser as a file.
 *
 * The object URL is revoked on the next frame rather than immediately: Safari
 * cancels a download whose URL is released inside the same task.
 */
export function downloadIcs(content: Uint8Array, filename: string): void {
  // Copy into a plain ArrayBuffer: a Uint8Array can be backed by a
  // SharedArrayBuffer, which Blob does not accept.
  const bytes = new Uint8Array(content);
  const url = URL.createObjectURL(
    new Blob([bytes.buffer as ArrayBuffer], { type: ICALENDAR_MIME_TYPE }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  requestAnimationFrame(() => URL.revokeObjectURL(url));
}
