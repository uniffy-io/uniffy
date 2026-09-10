/** `.mp4` for `clip.mp4`; empty for dotfiles and names without a dot. Same rule as the backend. */
export function fileExtension(filename: string): string {
  const dot = filename.lastIndexOf(".");
  if (dot <= 0 || dot === filename.length - 1) return "";
  return filename.slice(dot);
}
