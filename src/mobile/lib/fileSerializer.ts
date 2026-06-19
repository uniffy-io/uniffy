import type { File, TreeNode } from "@uniffy/proto/files/v1/files_pb";

export interface SerializedFile {
  id: string;
  filename: string;
  ext: string;
  mimeType: string;
  size: string;
  version: number;
  description?: string;
  editedAt: string;
  ownerInfo?: { id: string; name: string; email: string };
  tags: string[];
}

export interface PlainTreeNode {
  id: string;
  name: string;
  isFolder: boolean;
  children: PlainTreeNode[];
  childCount: number;
  size?: string;
  ext: string;
}

function formatSize(bytes: number): string {
  if (bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const value = bytes / Math.pow(1024, i);
  return `${i === 0 ? value : value.toFixed(1)} ${units[i]}`;
}

function extFromFilename(filename: string): string {
  const dot = filename.lastIndexOf(".");
  if (dot <= 0 || dot === filename.length - 1) return "";
  return filename.slice(dot + 1).toLowerCase();
}

function extFromMime(mime?: string): string | undefined {
  if (!mime) return undefined;
  const sub = mime.split("/")[1];
  if (!sub) return undefined;
  return sub.split("+")[0].toLowerCase();
}

function tsToIso(ts?: { seconds: bigint; nanos: number }): string {
  if (!ts) return new Date(0).toISOString();
  return new Date(Number(ts.seconds) * 1000 + Math.floor(ts.nanos / 1e6)).toISOString();
}

export function fileToPlain(file: File): SerializedFile {
  return {
    id: file.id,
    filename: file.filename,
    ext: extFromFilename(file.filename),
    mimeType: file.mimeType,
    size: formatSize(Number(file.sizeBytes)),
    version: file.version,
    description: file.description,
    editedAt: tsToIso(file.updatedAt),
    ownerInfo: file.ownerInfo
      ? { id: file.ownerInfo.id, name: file.ownerInfo.name, email: file.ownerInfo.email }
      : undefined,
    tags: file.tags.map((t) => t.name),
  };
}

export function treeNodeToPlain(node: TreeNode): PlainTreeNode {
  return {
    id: node.id,
    name: node.name,
    isFolder: node.isFolder,
    children: node.children.map(treeNodeToPlain),
    childCount: node.childCount,
    size:
      !node.isFolder && node.sizeBytes !== undefined
        ? formatSize(Number(node.sizeBytes))
        : undefined,
    ext: node.isFolder ? "" : extFromFilename(node.name) || extFromMime(node.mimeType) || "",
  };
}
