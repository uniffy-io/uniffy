import type {
  File,
  TreeNode,
  PlaybackStatus,
  TranscodeStatus,
} from "@uniffy/proto/files/v1/files_pb";

export interface SerializedFileTag {
  id: string;
  name: string;
  color: string;
}

export interface SerializedFileMetadata {
  width?: number;
  height?: number;
  durationSeconds?: number;
  pageCount?: number;
  format?: string;
  colorMode?: string;
  bitrate?: number;
  sampleRate?: number;
  channels?: number;
  exif: Record<string, string>;
}

export interface SerializedFile {
  id: string;
  urn: string;
  filename: string;
  ext: string;
  mimeType: string;
  size: string;
  version: number;
  playbackStatus: PlaybackStatus;
  transcodeStatus: TranscodeStatus;
  description?: string;
  editedAt: string;
  createdAt: string;
  folderId?: string;
  ownerInfo?: { id: string; name: string; email: string };
  tags: string[];
  tagObjects: SerializedFileTag[];
  metadata?: SerializedFileMetadata;
}

export interface PlainTreeNode {
  id: string;
  name: string;
  isFolder: boolean;
  children: PlainTreeNode[];
  childCount: number;
  size?: string;
  sizeBytes: number;
  mimeType?: string;
  ext: string;
}

export function formatSize(bytes: number): string {
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
  const m = file.metadata;
  return {
    id: file.id,
    urn: file.urn,
    filename: file.filename,
    ext: extFromFilename(file.filename),
    mimeType: file.mimeType,
    size: formatSize(Number(file.sizeBytes)),
    version: file.version,
    playbackStatus: file.playbackStatus,
    transcodeStatus: file.transcodeStatus,
    description: file.description,
    editedAt: tsToIso(file.updatedAt),
    createdAt: tsToIso(file.createdAt),
    folderId: file.folderId,
    ownerInfo: file.ownerInfo
      ? { id: file.ownerInfo.id, name: file.ownerInfo.name, email: file.ownerInfo.email }
      : undefined,
    tags: file.tags.map((t) => t.name),
    tagObjects: file.tags.map((t) => ({ id: t.id, name: t.name, color: t.color || "#7C5CFC" })),
    metadata: m
      ? {
          width: m.width,
          height: m.height,
          durationSeconds: m.durationSeconds,
          pageCount: m.pageCount,
          format: m.format,
          colorMode: m.colorMode,
          bitrate: m.bitrate,
          sampleRate: m.sampleRate,
          channels: m.channels,
          exif: m.exif ?? {},
        }
      : undefined,
  };
}

export function treeNodeToPlain(node: TreeNode): PlainTreeNode {
  const sizeBytes = !node.isFolder && node.sizeBytes !== undefined ? Number(node.sizeBytes) : 0;
  return {
    id: node.id,
    name: node.name,
    isFolder: node.isFolder,
    children: node.children.map(treeNodeToPlain),
    childCount: node.childCount,
    size: !node.isFolder && node.sizeBytes !== undefined ? formatSize(sizeBytes) : undefined,
    sizeBytes,
    mimeType: node.mimeType,
    ext: node.isFolder ? "" : extFromFilename(node.name) || extFromMime(node.mimeType) || "",
  };
}
