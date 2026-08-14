/** Format: `Screen Recording 2026-05-09 13.42.05.mp4` (locale-independent, mirrors macOS). */

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

export function buildRecordingFilename(extension: string, now: Date = new Date()): string {
  const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const time = `${pad(now.getHours())}.${pad(now.getMinutes())}.${pad(now.getSeconds())}`;
  return `Screen Recording ${date} ${time}.${extension}`;
}
