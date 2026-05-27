import { useState, useMemo, useCallback } from 'react';
import {
    FolderOpen,
    CaretDown,
    CaretRight,
    Warning,
    CheckSquare,
    Square,
    MinusSquare,
    File as FileIcon,
} from '@phosphor-icons/react';
import { useAppSelector } from '@/app/hooks';
import { Button } from '@/components/ui/button';
import { formatFileSize } from '@/shared/utils/dateFormatting';
import { cn } from '@/shared/utils/cn';
import type { ScanResult, FolderTreeStructure } from '@/features/files/utils/folderScanner';

interface FolderUploadConfirmDialogProps {
    open: boolean;
    scanResult: ScanResult | null;
    onConfirm: (excludedPaths: Set<string>) => void;
    onCancel: () => void;
}

function collectDescendantPaths(
    node: FolderTreeStructure,
    folderPath: string,
): string[] {
    const paths: string[] = [];
    for (const file of node.files) {
        paths.push(`${folderPath}/${file.name}`);
    }
    for (const child of node.children) {
        const childPath = `${folderPath}/${child.name}`;
        paths.push(childPath);
        paths.push(...collectDescendantPaths(child, childPath));
    }
    return paths;
}

export function FolderUploadConfirmDialog({
    open,
    scanResult,
    onConfirm,
    onCancel,
}: FolderUploadConfirmDialogProps) {
    const myStorageUsage = useAppSelector((state) => state.files.myStorageUsage);
    const [excludedPaths, setExcludedPaths] = useState<Set<string>>(new Set());

    const togglePath = useCallback((path: string) => {
        setExcludedPaths((prev) => {
            const next = new Set(prev);
            if (next.has(path)) {
                next.delete(path);
            } else {
                next.add(path);
            }
            return next;
        });
    }, []);

    const toggleFolder = useCallback((
        node: FolderTreeStructure,
        folderPath: string,
        shouldExclude: boolean,
    ) => {
        setExcludedPaths((prev) => {
            const next = new Set(prev);
            const descendants = collectDescendantPaths(node, folderPath);
            if (shouldExclude) {
                next.add(folderPath);
                for (const d of descendants) next.add(d);
            } else {
                next.delete(folderPath);
                for (const d of descendants) next.delete(d);
            }
            return next;
        });
    }, []);

    const includedFiles = useMemo(() => {
        if (!scanResult) return [];
        return scanResult.files.filter((f) => !excludedPaths.has(f.path));
    }, [scanResult, excludedPaths]);

    const includedSize = useMemo(() => {
        return includedFiles.reduce((sum, f) => sum + f.file.size, 0);
    }, [includedFiles]);

    const quotaImpact = useMemo(() => {
        const currentUsed = myStorageUsage.usedBytes;
        const quota = myStorageUsage.quotaBytes;

        if (quota === null) {
            return { wouldExceed: false, remaining: null, projectedPercent: 0 };
        }

        const projectedUsage = currentUsed + includedSize;
        return {
            wouldExceed: projectedUsage > quota,
            remaining: Math.max(0, quota - currentUsed),
            projectedPercent: (projectedUsage / quota) * 100,
        };
    }, [myStorageUsage, includedSize]);

    const handleConfirm = useCallback(() => {
        onConfirm(excludedPaths);
        setExcludedPaths(new Set());
    }, [onConfirm, excludedPaths]);

    const handleCancel = useCallback(() => {
        setExcludedPaths(new Set());
        onCancel();
    }, [onCancel]);

    if (!open || !scanResult) return null;

    const totalFiles = scanResult.files.length;
    const excludedCount = totalFiles - includedFiles.length;

    return (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
            <div className="fixed inset-0 bg-black/50" onClick={handleCancel} />
            <div
                className={cn(
                    'relative bg-card border border-border rounded-t-xl sm:rounded-xl shadow-lg',
                    'w-[calc(100vw-2rem)] max-w-lg p-6',
                    'max-h-[85vh] flex flex-col',
                )}
            >
                <div className="flex items-center gap-3 mb-4">
                    <div className="p-2 rounded-lg bg-primary/10">
                        <FolderOpen size={24} weight="duotone" className="text-primary" />
                    </div>
                    <div>
                        <h2 className="text-lg font-semibold text-foreground">Upload Folder</h2>
                        <p className="text-xs text-muted-foreground">
                            Uncheck files or folders to exclude them
                        </p>
                    </div>
                </div>

                <div className="space-y-4 overflow-y-auto flex-1 min-h-0">
                    {/* Summary stats */}
                    <div className="grid grid-cols-3 gap-3">
                        <div className="rounded-md bg-muted/50 p-3 text-center">
                            <p className="text-lg font-semibold text-foreground">
                                {includedFiles.length}
                                {excludedCount > 0 && (
                                    <span className="text-xs text-muted-foreground font-normal"> / {totalFiles}</span>
                                )}
                            </p>
                            <p className="text-xs text-muted-foreground">Files</p>
                        </div>
                        <div className="rounded-md bg-muted/50 p-3 text-center">
                            <p className="text-lg font-semibold text-foreground">{scanResult.folderCount}</p>
                            <p className="text-xs text-muted-foreground">Folders</p>
                        </div>
                        <div className="rounded-md bg-muted/50 p-3 text-center">
                            <p className="text-lg font-semibold text-foreground">
                                {formatFileSize(includedSize)}
                            </p>
                            <p className="text-xs text-muted-foreground">Total Size</p>
                        </div>
                    </div>

                    {/* Truncation warning */}
                    {scanResult.truncated && (
                        <div className="flex items-center gap-2 p-3 rounded-md bg-yellow-100 dark:bg-yellow-900/30 text-yellow-800 dark:text-yellow-400 text-sm">
                            <Warning size={16} weight="fill" className="shrink-0" />
                            <span>File limit reached (10,000). Some files will not be uploaded.</span>
                        </div>
                    )}

                    {/* Quota impact */}
                    {quotaImpact.remaining !== null && (
                        <div
                            className={cn(
                                'p-3 rounded-md text-sm',
                                quotaImpact.wouldExceed
                                    ? 'bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-400'
                                    : 'bg-muted/50 text-muted-foreground',
                            )}
                        >
                            {quotaImpact.wouldExceed ? (
                                <div className="flex items-center gap-2">
                                    <Warning size={16} weight="fill" className="shrink-0" />
                                    <span>
                                        Upload ({formatFileSize(includedSize)}) exceeds remaining
                                        quota ({formatFileSize(quotaImpact.remaining)}).
                                    </span>
                                </div>
                            ) : (
                                <span>
                                    This will use {formatFileSize(includedSize)} of
                                    your remaining {formatFileSize(quotaImpact.remaining)}.
                                </span>
                            )}
                        </div>
                    )}

                    {/* Folder tree with checkboxes */}
                    {scanResult.tree.length > 0 && (
                        <div>
                            <p className="text-xs font-medium text-muted-foreground mb-2 uppercase tracking-wider">
                                Contents
                            </p>
                            <div className="border border-border rounded-md max-h-72 overflow-y-auto bg-muted/20">
                                <div className="p-2">
                                    {scanResult.tree.map((node, idx) => (
                                        <TreePreviewNode
                                            key={idx}
                                            node={node}
                                            depth={0}
                                            parentPath=""
                                            excludedPaths={excludedPaths}
                                            onToggleFile={togglePath}
                                            onToggleFolder={toggleFolder}
                                        />
                                    ))}
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Flat file list fallback */}
                    {scanResult.tree.length === 0 && scanResult.files.length > 0 && (
                        <div>
                            <p className="text-xs font-medium text-muted-foreground mb-2 uppercase tracking-wider">Files</p>
                            <div className="border border-border rounded-md max-h-72 overflow-y-auto bg-muted/20">
                                <div className="p-2 space-y-0.5">
                                    {scanResult.files.map((f, idx) => {
                                        const isExcluded = excludedPaths.has(f.path);
                                        return (
                                            <button
                                                key={idx}
                                                onClick={() => togglePath(f.path)}
                                                className="flex items-center gap-2 py-1 px-2 text-sm rounded hover:bg-muted/50 w-full text-left"
                                            >
                                                {isExcluded ? (
                                                    <Square size={14} className="text-muted-foreground shrink-0" />
                                                ) : (
                                                    <CheckSquare size={14} weight="fill" className="text-primary shrink-0" />
                                                )}
                                                <FileIcon size={14} weight="duotone" className={cn('shrink-0', isExcluded ? 'text-muted-foreground/40' : 'text-muted-foreground')} />
                                                <span className={cn('truncate flex-1', isExcluded && 'text-muted-foreground line-through')}>{f.file.name}</span>
                                                <span className="text-xs text-muted-foreground shrink-0 tabular-nums">
                                                    {formatFileSize(f.file.size)}
                                                </span>
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>
                        </div>
                    )}
                </div>

                <div className="flex items-center justify-between mt-6 pt-4 border-t border-border shrink-0">
                    <div className="text-xs text-muted-foreground">
                        {excludedCount > 0 && `${excludedCount} item${excludedCount !== 1 ? 's' : ''} excluded`}
                    </div>
                    <div className="flex gap-3">
                        <Button variant="outline" onClick={handleCancel}>
                            Cancel
                        </Button>
                        <Button
                            onClick={handleConfirm}
                            disabled={quotaImpact.wouldExceed || includedFiles.length === 0}
                        >
                            Upload {includedFiles.length} File{includedFiles.length !== 1 ? 's' : ''}
                        </Button>
                    </div>
                </div>
            </div>
        </div>
    );
}

interface TreePreviewNodeProps {
    node: FolderTreeStructure;
    depth: number;
    parentPath: string;
    excludedPaths: Set<string>;
    onToggleFile: (path: string) => void;
    onToggleFolder: (node: FolderTreeStructure, folderPath: string, shouldExclude: boolean) => void;
}

function TreePreviewNode({
    node,
    depth,
    parentPath,
    excludedPaths,
    onToggleFile,
    onToggleFolder,
}: TreePreviewNodeProps) {
    const [expanded, setExpanded] = useState(true);
    const folderPath = parentPath ? `${parentPath}/${node.name}` : node.name;
    const isFolderExcluded = excludedPaths.has(folderPath);

    const hasContents = node.children.length > 0 || node.files.length > 0;

    const checkState = useMemo(() => {
        if (isFolderExcluded) return 'unchecked';
        const descendants = collectDescendantPaths(node, folderPath);
        if (descendants.length === 0) return 'checked';
        const excludedCount = descendants.filter((d) => excludedPaths.has(d)).length;
        if (excludedCount === 0) return 'checked';
        if (excludedCount === descendants.length) return 'unchecked';
        return 'indeterminate';
    }, [isFolderExcluded, node, folderPath, excludedPaths]);

    const handleFolderToggle = (e: React.MouseEvent) => {
        e.stopPropagation();
        onToggleFolder(node, folderPath, checkState !== 'unchecked');
    };

    const fileCount = node.files.length;
    const subfolderCount = node.children.length;
    const summary = [
        fileCount > 0 ? `${fileCount} file${fileCount !== 1 ? 's' : ''}` : null,
        subfolderCount > 0 ? `${subfolderCount} folder${subfolderCount !== 1 ? 's' : ''}` : null,
    ].filter(Boolean).join(', ');

    return (
        <div className={cn(isFolderExcluded && 'opacity-50')}>
            <div
                className="flex items-center gap-1.5 py-1 px-1.5 rounded text-sm hover:bg-muted/50 cursor-pointer"
                style={{ paddingLeft: `${depth * 16 + 4}px` }}
                onClick={() => hasContents && setExpanded(!expanded)}
            >
                {hasContents ? (
                    expanded
                        ? <CaretDown size={12} className="text-muted-foreground shrink-0" />
                        : <CaretRight size={12} className="text-muted-foreground shrink-0" />
                ) : (
                    <span className="w-3" />
                )}

                <span onClick={handleFolderToggle} className="shrink-0 cursor-pointer">
                    {checkState === 'checked' ? (
                        <CheckSquare size={15} weight="fill" className="text-primary" />
                    ) : checkState === 'indeterminate' ? (
                        <MinusSquare size={15} weight="fill" className="text-primary" />
                    ) : (
                        <Square size={15} className="text-muted-foreground" />
                    )}
                </span>

                <FolderOpen size={14} weight="duotone" className="text-primary shrink-0" />
                <span className={cn('truncate font-medium', isFolderExcluded && 'line-through text-muted-foreground')}>
                    {node.name}
                </span>
                {summary && (
                    <span className="text-xs text-muted-foreground ml-auto shrink-0 pl-2">
                        {summary}
                    </span>
                )}
            </div>
            {expanded && !isFolderExcluded && (
                <>
                    {node.children.map((child, idx) => (
                        <TreePreviewNode
                            key={`d-${idx}`}
                            node={child}
                            depth={depth + 1}
                            parentPath={folderPath}
                            excludedPaths={excludedPaths}
                            onToggleFile={onToggleFile}
                            onToggleFolder={onToggleFolder}
                        />
                    ))}
                    {node.files.map((file, idx) => {
                        const filePath = `${folderPath}/${file.name}`;
                        const isExcluded = excludedPaths.has(filePath);
                        return (
                            <button
                                key={`f-${idx}`}
                                className="flex items-center gap-1.5 py-0.5 px-1.5 text-sm w-full text-left hover:bg-muted/50 rounded"
                                style={{ paddingLeft: `${(depth + 1) * 16 + 4}px` }}
                                onClick={() => onToggleFile(filePath)}
                            >
                                <span className="w-3" />
                                {isExcluded ? (
                                    <Square size={15} className="text-muted-foreground shrink-0" />
                                ) : (
                                    <CheckSquare size={15} weight="fill" className="text-primary shrink-0" />
                                )}
                                <FileIcon size={14} weight="duotone" className={cn('shrink-0', isExcluded ? 'text-muted-foreground/40' : 'text-muted-foreground')} />
                                <span className={cn('truncate', isExcluded && 'line-through text-muted-foreground')}>
                                    {file.name}
                                </span>
                                <span className="text-xs text-muted-foreground ml-auto shrink-0 pl-2 tabular-nums">
                                    {formatFileSize(file.size)}
                                </span>
                            </button>
                        );
                    })}
                </>
            )}
        </div>
    );
}
