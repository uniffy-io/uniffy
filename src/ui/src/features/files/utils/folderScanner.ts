const MAX_DEPTH = 20;
const MAX_FILES = 10000;
const HIDDEN_FILES = new Set(['.DS_Store', 'Thumbs.db', 'desktop.ini', '.gitkeep']);

export interface ScannedFile {
    path: string;
    file: File;
}

export interface TreePreviewFile {
    name: string;
    size: number;
}

export interface FolderTreeStructure {
    name: string;
    children: FolderTreeStructure[];
    files: TreePreviewFile[];
}

export interface ScanResult {
    files: ScannedFile[];
    tree: FolderTreeStructure[];
    totalSize: number;
    folderCount: number;
    truncated: boolean;
}

function isHiddenFile(name: string): boolean {
    return name.startsWith('.') || HIDDEN_FILES.has(name);
}

async function readDirectoryEntries(
    reader: FileSystemDirectoryReader
): Promise<FileSystemEntry[]> {
    const entries: FileSystemEntry[] = [];
    let batch: FileSystemEntry[];

    do {
        batch = await new Promise<FileSystemEntry[]>((resolve, reject) => {
            reader.readEntries(resolve, reject);
        });
        entries.push(...batch);
    } while (batch.length > 0);

    return entries;
}

async function getFileFromEntry(entry: FileSystemFileEntry): Promise<File> {
    return new Promise<File>((resolve, reject) => {
        entry.file(resolve, reject);
    });
}

async function scanDirectoryEntry(
    entry: FileSystemDirectoryEntry,
    currentPath: string,
    depth: number,
    result: { files: ScannedFile[]; totalSize: number; folderCount: number; truncated: boolean },
): Promise<FolderTreeStructure> {
    const node: FolderTreeStructure = { name: entry.name, children: [], files: [] };
    result.folderCount += 1;

    if (depth >= MAX_DEPTH) {
        return node;
    }

    const reader = entry.createReader();
    const entries = await readDirectoryEntries(reader);

    for (const child of entries) {
        if (result.files.length >= MAX_FILES) {
            result.truncated = true;
            break;
        }

        if (isHiddenFile(child.name)) {
            continue;
        }

        const childPath = currentPath ? `${currentPath}/${child.name}` : child.name;

        if (child.isFile) {
            try {
                const file = await getFileFromEntry(child as FileSystemFileEntry);
                result.files.push({ path: childPath, file });
                result.totalSize += file.size;
                node.files.push({ name: file.name, size: file.size });
            } catch {
                // Unreadable entries (e.g. broken symlinks) are skipped.
            }
        } else if (child.isDirectory) {
            const childNode = await scanDirectoryEntry(
                child as FileSystemDirectoryEntry,
                childPath,
                depth + 1,
                result,
            );
            node.children.push(childNode);
        }
    }

    return node;
}

/** Uses webkitGetAsEntry() to walk dropped folders; falls back to the flat file list when unsupported. */
export async function scanDroppedItems(dataTransfer: DataTransfer): Promise<ScanResult> {
    const result: ScanResult = {
        files: [],
        tree: [],
        totalSize: 0,
        folderCount: 0,
        truncated: false,
    };

    const items = dataTransfer.items;
    if (!items || items.length === 0) {
        return result;
    }

    const firstItem = items[0];
    if (!firstItem.webkitGetAsEntry) {
        for (let i = 0; i < dataTransfer.files.length; i++) {
            const file = dataTransfer.files[i];
            if (!isHiddenFile(file.name)) {
                result.files.push({ path: file.name, file });
                result.totalSize += file.size;
            }
        }
        return result;
    }

    for (let i = 0; i < items.length; i++) {
        if (result.files.length >= MAX_FILES) {
            result.truncated = true;
            break;
        }

        const entry = items[i].webkitGetAsEntry();
        if (!entry) continue;

        if (isHiddenFile(entry.name)) continue;

        if (entry.isFile) {
            try {
                const file = await getFileFromEntry(entry as FileSystemFileEntry);
                result.files.push({ path: file.name, file });
                result.totalSize += file.size;
            } catch {
                // Unreadable entries are skipped.
            }
        } else if (entry.isDirectory) {
            const node = await scanDirectoryEntry(
                entry as FileSystemDirectoryEntry,
                entry.name,
                1,
                result,
            );
            result.tree.push(node);
        }
    }

    return result;
}

/** Reconstructs the folder tree from each file's webkitRelativePath (input[webkitdirectory]). */
export function scanInputFiles(fileList: FileList): ScanResult {
    const result: ScanResult = {
        files: [],
        tree: [],
        totalSize: 0,
        folderCount: 0,
        truncated: false,
    };

    const folderPaths = new Set<string>();
    const filesByFolder = new Map<string, TreePreviewFile[]>();

    for (let i = 0; i < fileList.length; i++) {
        if (result.files.length >= MAX_FILES) {
            result.truncated = true;
            break;
        }

        const file = fileList[i];
        const relativePath = (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name;

        if (isHiddenFile(file.name)) continue;

        result.files.push({ path: relativePath, file });
        result.totalSize += file.size;

        const parts = relativePath.split('/');
        for (let j = 1; j < parts.length; j++) {
            folderPaths.add(parts.slice(0, j).join('/'));
        }

        const parentPath = parts.slice(0, -1).join('/');
        const bucket = filesByFolder.get(parentPath);
        const entry: TreePreviewFile = { name: file.name, size: file.size };
        if (bucket) {
            bucket.push(entry);
        } else {
            filesByFolder.set(parentPath, [entry]);
        }
    }

    result.folderCount = folderPaths.size;
    result.tree = buildTreeFromPaths(folderPaths, filesByFolder);

    return result;
}

function buildTreeFromPaths(
    paths: Set<string>,
    filesByFolder: Map<string, TreePreviewFile[]>,
): FolderTreeStructure[] {
    const roots: FolderTreeStructure[] = [];
    const nodeMap = new Map<string, FolderTreeStructure>();

    const sortedPaths = Array.from(paths).sort();

    for (const path of sortedPaths) {
        const parts = path.split('/');
        const name = parts[parts.length - 1];
        const node: FolderTreeStructure = {
            name,
            children: [],
            files: filesByFolder.get(path) ?? [],
        };
        nodeMap.set(path, node);

        if (parts.length === 1) {
            roots.push(node);
        } else {
            const parentPath = parts.slice(0, -1).join('/');
            const parent = nodeMap.get(parentPath);
            if (parent) {
                parent.children.push(node);
            }
        }
    }

    return roots;
}

export function hasDroppedFolders(dataTransfer: DataTransfer): boolean {
    const items = dataTransfer.items;
    if (!items || items.length === 0) return false;

    for (let i = 0; i < items.length; i++) {
        const entry = items[i].webkitGetAsEntry?.();
        if (entry?.isDirectory) return true;
    }

    return false;
}

export function isFolderUploadSupported(): boolean {
    if (typeof DataTransferItem !== 'undefined' && 'webkitGetAsEntry' in DataTransferItem.prototype) {
        return true;
    }
    const input = document.createElement('input');
    return 'webkitdirectory' in input;
}
