import { useState, useCallback, useEffect, useRef } from "react";
import { useNavigate, useLocation, Link } from "react-router-dom";
import {
  CaretDown,
  CaretUp,
  CaretDoubleLeft,
  Folder,
  FolderOpen,
  LockSimple,
  Buildings,
  Trash,
  ArrowsClockwise,
  SquaresFour,
  File,
  CloudArrowUp,
  CloudArrowDown,
  UsersThree,
  Funnel,
} from "@phosphor-icons/react";
import type { Icon } from "@phosphor-icons/react";
import { useAppDispatch, useAppSelector } from "@/app/hooks";
import { cn } from "@/shared/utils/cn";
import { useBreakpoint } from "@/shared/hooks/useBreakpoint";
import { useOverlayEscape } from "@/shared/hooks/useOverlayEscape";
import { CompactNavItem } from "@/components/layout/CompactNavItem";
import { popoverEnterClass, popoverShellClass } from "@/components/ui/popover";
import {
  toggleNodeExpanded,
  fetchFilesTree,
  expandAll,
  collapseAll,
} from "@/features/files/store/filesTreeSlice";
import { setViewScope, initializeFilesData } from "@/features/files/store/filesSlice";
import { StorageUsageIndicator } from "@/features/admin/components/storage/StorageUsageIndicator";
import { setTrayView } from "@/features/files/store/uploadSlice";
import type { SerializedTreeNode } from "@/features/files/store/filesTreeThunks";

// Scope filter configuration
interface ScopeFilterConfig {
  id: "all" | "personal" | "shared" | "organization";
  name: string;
  icon: typeof Folder;
}

const SCOPE_FILTERS: ScopeFilterConfig[] = [
  { id: "all", name: "All Files", icon: SquaresFour },
  { id: "personal", name: "Personal Space", icon: LockSimple },
  { id: "shared", name: "Shared With Me", icon: UsersThree },
  { id: "organization", name: "Organization", icon: Buildings },
];

// Files navigation items
interface FilesNavItem {
  name: string;
  path: string;
  icon: Icon;
}

const filesNavItems: FilesNavItem[] = [
  { name: "All Files", path: "/files", icon: SquaresFour },
  { name: "Filters", path: "/files/filters", icon: Funnel },
];

function findPathInNodes(
  nodes: SerializedTreeNode[],
  targetId: string,
  currentPath: string[],
): string[] | null {
  for (const node of nodes) {
    if (node.id === targetId) return currentPath;
    if (node.children) {
      const found = findPathInNodes(node.children, targetId, [...currentPath, node.id]);
      if (found) return found;
    }
  }
  return null;
}

interface FilesSidebarProps {
  onToggleSidebar?: () => void;
  onUpload?: () => void;
  onUploadFolder?: () => void;
}

export function FilesSidebar({ onToggleSidebar, onUpload, onUploadFolder }: FilesSidebarProps) {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const location = useLocation();
  const { isMobile } = useBreakpoint();

  const tree = useAppSelector((state) => state.filesTree.tree);
  const expandedNodes = useAppSelector((state) => state.filesTree.expandedNodes);
  const selectedFolderId = useAppSelector((state) => state.filesTree.selectedFolderId);
  const loading = useAppSelector((state) => state.filesTree.loading);

  const viewScope = useAppSelector((state) => state.files.filters.viewScope);

  // Upload/Download status
  const activeUploadCount = useAppSelector(
    (state) =>
      state.upload.records.filter(
        (r) => r.status === "uploading" || r.status === "completing" || r.status === "queued",
      ).length,
  );
  const isUploading = activeUploadCount > 0;
  const isDownloading = useAppSelector((state) => state.upload.isDownloading);
  const showPanel = useAppSelector((state) => state.upload.trayView === "expanded");
  const activeDownloadCount = useAppSelector(
    (state) => Object.keys(state.upload.activeDownloads).length,
  );
  const hasTransferActivity = isUploading || isDownloading;

  const findPathToFolder = useCallback(
    (folderId: string): string[] =>
      findPathInNodes(tree.personal, folderId, ["personal"]) ??
      findPathInNodes(tree.organization, folderId, ["organization"]) ??
      [],
    [tree],
  );

  // Auto-expand path to selected folder when it changes
  useEffect(() => {
    if (selectedFolderId) {
      const pathToExpand = findPathToFolder(selectedFolderId);
      // Expand all nodes in the path that aren't already expanded
      for (const nodeId of pathToExpand) {
        if (!expandedNodes.includes(nodeId)) {
          dispatch(toggleNodeExpanded(nodeId));
        }
      }
    }
  }, [selectedFolderId, findPathToFolder, expandedNodes, dispatch]);

  // Refresh tree
  const handleRefresh = useCallback(() => {
    dispatch(fetchFilesTree({ includeFiles: false }));
    dispatch(initializeFilesData({ forceRefresh: true }));
  }, [dispatch]);

  const handleScopeChange = useCallback(
    (scope: "all" | "personal" | "shared" | "organization") => {
      dispatch(setViewScope(scope));
      navigate("/files"); // Clear folder param
    },
    [dispatch, navigate],
  );

  // Upload menu popover (shown when idle so user can pick files vs folder)
  const uploadButtonRef = useRef<HTMLButtonElement>(null);
  const uploadMenuRef = useRef<HTMLDivElement>(null);
  const [uploadMenuOpen, setUploadMenuOpen] = useState(false);
  const [uploadMenuPos, setUploadMenuPos] = useState<{ x: number; y: number }>({ x: 0, y: 0 });

  useEffect(() => {
    if (!uploadMenuOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (
        uploadMenuRef.current &&
        !uploadMenuRef.current.contains(e.target as Node) &&
        uploadButtonRef.current &&
        !uploadButtonRef.current.contains(e.target as Node)
      ) {
        setUploadMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [uploadMenuOpen]);

  useOverlayEscape(() => setUploadMenuOpen(false), uploadMenuOpen);

  const handleUploadClick = useCallback(() => {
    if (hasTransferActivity) {
      // When there's activity, expand the transfers tray (or collapse it if already open).
      dispatch(setTrayView(showPanel ? "minimized" : "expanded"));
      return;
    }
    // When idle, open a small menu so the user can pick files or a folder
    const rect = uploadButtonRef.current?.getBoundingClientRect();
    if (rect) {
      const menuWidth = 180;
      const menuHeight = 90;
      const x = rect.left + menuWidth > window.innerWidth ? rect.right - menuWidth : rect.left;
      const y =
        rect.bottom + menuHeight > window.innerHeight ? rect.top - menuHeight - 4 : rect.bottom + 4;
      setUploadMenuPos({ x, y });
    }
    setUploadMenuOpen((prev) => !prev);
  }, [dispatch, hasTransferActivity, showPanel]);

  const handleSelectUploadFiles = useCallback(() => {
    setUploadMenuOpen(false);
    onUpload?.();
  }, [onUpload]);

  const handleSelectUploadFolder = useCallback(() => {
    setUploadMenuOpen(false);
    onUploadFolder?.();
  }, [onUploadFolder]);

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center px-3 pt-3 pb-2 gap-0.5">
        {/* Upload/Status Button */}
        <button
          ref={uploadButtonRef}
          onClick={handleUploadClick}
          className={cn(
            "group relative flex items-center py-1.5 px-1.5 text-sm font-medium rounded-lg transition-all duration-700 ease-out overflow-hidden hover:px-2.5",
            showPanel && hasTransferActivity && "bg-muted",
            uploadMenuOpen && "bg-muted",
          )}
          title={hasTransferActivity ? "View transfer status" : "Upload"}
        >
          <span className="absolute bottom-0 left-1/2 -translate-x-1/2 h-0.5 rounded-full bg-primary transition-all duration-700 ease-out w-0 opacity-0 group-hover:w-1/2 group-hover:opacity-70" />
          <span className="relative z-10 flex items-center justify-center w-7 h-7 rounded-md transition-all duration-500 ease-out text-muted-foreground group-hover:text-primary">
            {isDownloading && !isUploading ? (
              <CloudArrowDown
                size={18}
                weight="bold"
                className={isDownloading ? "animate-pulse" : ""}
              />
            ) : (
              <CloudArrowUp
                size={18}
                weight="bold"
                className={isUploading ? "animate-pulse" : ""}
              />
            )}
          </span>
          <span className="relative z-10 ml-0 max-w-0 overflow-hidden whitespace-nowrap transition-all duration-700 ease-out group-hover:ml-1.5 group-hover:max-w-24 text-muted-foreground group-hover:text-foreground">
            {hasTransferActivity ? (
              <span className="tabular-nums">
                {isUploading && `${activeUploadCount}↑`}
                {isUploading && isDownloading && " "}
                {isDownloading && `${activeDownloadCount}↓`}
              </span>
            ) : (
              "Upload"
            )}
          </span>
        </button>
        {uploadMenuOpen && (
          <div
            ref={uploadMenuRef}
            className={cn(
              popoverShellClass,
              popoverEnterClass,
              "fixed z-50 min-w-44 overflow-hidden",
            )}
            style={{ top: uploadMenuPos.y, left: uploadMenuPos.x }}
          >
            <div className="py-1">
              <button
                onClick={handleSelectUploadFiles}
                className="flex w-full items-center gap-2 px-3 py-2 text-sm text-foreground hover:bg-muted transition-colors"
              >
                <File size={16} weight="duotone" className="text-primary" />
                Upload Files
              </button>
              {onUploadFolder && (
                <button
                  onClick={handleSelectUploadFolder}
                  className="flex w-full items-center gap-2 px-3 py-2 text-sm text-foreground hover:bg-muted transition-colors"
                >
                  <FolderOpen size={16} weight="duotone" className="text-primary" />
                  Upload Folder
                </button>
              )}
            </div>
          </div>
        )}
        {filesNavItems.map((item) => {
          const isActive =
            item.path === "/files"
              ? location.pathname === "/files" && !location.search.includes("folder=")
              : location.pathname === item.path;
          return (
            <CompactNavItem
              key={item.path}
              to={item.path}
              label={item.name}
              icon={item.icon}
              isActive={isActive}
            />
          );
        })}
        <div className="flex-1" />
        {/* Hide collapse button on mobile (drawer has its own close) */}
        {onToggleSidebar && !isMobile && (
          <button
            onClick={onToggleSidebar}
            className="p-1.5 rounded-md bg-transparent hover:bg-muted transition-colors flex-shrink-0"
            title="Toggle sidebar"
          >
            <CaretDoubleLeft size={16} weight="bold" className="text-primary" />
          </button>
        )}
      </div>

      {/* Main Sections */}
      <div className="flex-1 overflow-y-auto px-3 py-2">
        <nav className="space-y-0.5">
          {/* Tree controls */}
          <div className="flex items-center gap-0.5 mb-1">
            <button
              onClick={() => dispatch(expandAll())}
              className="p-1 rounded-md bg-transparent hover:bg-muted transition-colors"
              title="Expand all"
            >
              <CaretDown size={14} weight="bold" className="text-muted-foreground" />
            </button>
            <button
              onClick={() => dispatch(collapseAll())}
              className="p-1 rounded-md bg-transparent hover:bg-muted transition-colors"
              title="Collapse all"
            >
              <CaretUp size={14} weight="bold" className="text-muted-foreground" />
            </button>
            <button
              onClick={handleRefresh}
              disabled={loading}
              className="p-1 rounded-md bg-transparent hover:bg-muted transition-colors disabled:opacity-50"
              title="Refresh"
            >
              <ArrowsClockwise
                size={14}
                weight="bold"
                className={cn("text-muted-foreground", loading && "animate-spin")}
              />
            </button>
          </div>

          {/* Scope Filters */}
          <div className="space-y-0.5 pt-2">
            {SCOPE_FILTERS.map((filter) => {
              const IconComponent = filter.icon;
              const isActive = viewScope === filter.id;

              return (
                <button
                  key={filter.id}
                  onClick={() => handleScopeChange(filter.id)}
                  className={cn(
                    "w-full flex items-center gap-2 px-2 py-2 text-sm rounded-md transition-colors text-left",
                    isActive
                      ? "bg-muted text-foreground font-medium"
                      : "text-foreground/90 hover:bg-muted/60",
                  )}
                >
                  <IconComponent
                    size={16}
                    weight={isActive ? "fill" : "duotone"}
                    className={isActive ? "text-primary" : "text-muted-foreground"}
                  />
                  <span className="flex-1">{filter.name}</span>
                </button>
              );
            })}
          </div>

          {/* Trash */}
          <div className="mt-2 pt-2 border-t border-border">
            <Link
              to="/files/trash"
              className={cn(
                "w-full flex items-center gap-2 px-2 py-2 text-sm rounded-md transition-colors text-left",
                location.pathname === "/files/trash"
                  ? "bg-muted text-foreground font-medium"
                  : "text-foreground/90 hover:bg-muted/60",
              )}
            >
              <Trash
                size={16}
                weight={location.pathname === "/files/trash" ? "fill" : "duotone"}
                className={
                  location.pathname === "/files/trash" ? "text-primary" : "text-muted-foreground"
                }
              />
              <span className="flex-1">Trash</span>
            </Link>
          </div>
        </nav>
      </div>

      {/* Storage Usage */}
      <div className="px-1 pb-2 pt-1 border-t border-border mt-auto">
        <StorageUsageIndicator />
      </div>
    </div>
  );
}
