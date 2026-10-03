/**
 * Hand a blob to the browser as a downloaded file.
 *
 * The object URL is revoked on the next frame rather than immediately: Safari
 * cancels a download whose URL is released inside the same task.
 */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  requestAnimationFrame(() => URL.revokeObjectURL(url));
}
