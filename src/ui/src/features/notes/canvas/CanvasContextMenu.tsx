import { memo } from "react";
import {
  Trash,
  CopySimple,
  ArrowLineUp,
  ArrowLineDown,
  ArrowUp,
  ArrowDown,
  TreeStructure,
  Plus,
  ArrowsInSimple,
  ArrowsOutSimple,
  Palette,
  ArrowsClockwise,
} from "@phosphor-icons/react";
import { ActionMenu, ActionMenuItem, ActionMenuSeparator } from "@/components/ui/action-menu";
import { cn } from "@/shared/utils/cn";
import {
  MINDMAP_BRANCH_COLORS,
  MINDMAP_DIRECTIONS,
} from "@/features/notes/canvas/components/mindmapConstants";

export interface MindMapContextInfo {
  isRoot: boolean;
  hasChildren: boolean;
  isCollapsed: boolean;
  branchColor: string;
  direction: string;
  onAddChild: (nodeId: string) => void;
  onAddSibling: (nodeId: string) => void;
  onToggleCollapse: (nodeId: string) => void;
  onDeleteSubtree: (nodeId: string) => void;
  onBranchColorChange: (color: string) => void;
  onRotate: () => void;
}

interface CanvasContextMenuProps {
  x: number;
  y: number;
  nodeId: string;
  onClose: () => void;
  onDelete: (nodeId: string) => void;
  onDuplicate: (nodeId: string) => void;
  onBringToFront: (nodeId: string) => void;
  onSendToBack: (nodeId: string) => void;
  onBringForward: (nodeId: string) => void;
  onSendBackward: (nodeId: string) => void;
  mindMapInfo?: MindMapContextInfo;
}

interface MenuItem {
  label: string;
  icon: React.ComponentType<{ size: number; weight: string; className?: string }>;
  action: () => void;
  variant?: "destructive";
  shortcut?: string;
}

export const CanvasContextMenu = memo(function CanvasContextMenu({
  x,
  y,
  nodeId,
  onClose,
  onDelete,
  onDuplicate,
  onBringToFront,
  onSendToBack,
  onBringForward,
  onSendBackward,
  mindMapInfo,
}: CanvasContextMenuProps) {
  const renderItem = (item: MenuItem) => {
    const Icon = item.icon;
    return (
      <ActionMenuItem
        key={item.label}
        onClick={item.action}
        destructive={item.variant === "destructive"}
      >
        <Icon size={14} weight="duotone" />
        <span className="flex-1">{item.label}</span>
        {item.shortcut && (
          <span className="text-xs text-muted-foreground ml-4">{item.shortcut}</span>
        )}
      </ActionMenuItem>
    );
  };

  // Mind map node context menu
  if (mindMapInfo) {
    const treeItems: MenuItem[] = [
      {
        label: "Add child",
        icon: TreeStructure as MenuItem["icon"],
        shortcut: "Tab",
        action: () => {
          mindMapInfo.onAddChild(nodeId);
          onClose();
        },
      },
    ];

    if (!mindMapInfo.isRoot) {
      treeItems.push({
        label: "Add sibling",
        icon: Plus as MenuItem["icon"],
        shortcut: "Enter",
        action: () => {
          mindMapInfo.onAddSibling(nodeId);
          onClose();
        },
      });
    }

    const collapseItems: MenuItem[] = [];
    if (mindMapInfo.hasChildren) {
      collapseItems.push({
        label: mindMapInfo.isCollapsed ? "Expand" : "Collapse",
        icon: (mindMapInfo.isCollapsed ? ArrowsOutSimple : ArrowsInSimple) as MenuItem["icon"],
        shortcut: "Space",
        action: () => {
          mindMapInfo.onToggleCollapse(nodeId);
          onClose();
        },
      });
    }

    const deleteItems: MenuItem[] = [];
    if (!mindMapInfo.isRoot) {
      deleteItems.push({
        label: "Delete",
        icon: Trash as MenuItem["icon"],
        shortcut: "Del",
        action: () => {
          mindMapInfo.onDeleteSubtree(nodeId);
          onClose();
        },
        variant: "destructive",
      });
    }

    return (
      <ActionMenu
        open
        position={{ x, y }}
        onClose={onClose}
        label={mindMapInfo ? "Mind map actions" : "Canvas actions"}
      >
        {treeItems.map(renderItem)}
        {collapseItems.length > 0 && (
          <>
            <ActionMenuSeparator />
            {collapseItems.map(renderItem)}
          </>
        )}
        {/* Rotate direction (root only) */}
        {mindMapInfo.isRoot &&
          (() => {
            const curIdx = MINDMAP_DIRECTIONS.indexOf(
              (mindMapInfo.direction as (typeof MINDMAP_DIRECTIONS)[number]) || "right",
            );
            const nextDir = MINDMAP_DIRECTIONS[(curIdx + 1) % MINDMAP_DIRECTIONS.length];
            const dirLabels: Record<string, string> = {
              right: "Right",
              down: "Down",
              left: "Left",
              up: "Up",
            };
            return (
              <>
                <ActionMenuSeparator />
                {renderItem({
                  label: `Rotate (${dirLabels[nextDir]})`,
                  icon: ArrowsClockwise as MenuItem["icon"],
                  action: () => {
                    mindMapInfo.onRotate();
                    onClose();
                  },
                })}
              </>
            );
          })()}
        {/* Branch color picker (non-root only) */}
        {!mindMapInfo.isRoot && (
          <>
            <ActionMenuSeparator />
            <div className="px-3 py-1.5">
              <div className="flex items-center gap-2 text-sm text-foreground mb-1.5">
                <Palette size={14} weight="duotone" />
                <span>Branch color</span>
              </div>
              <div className="flex flex-wrap gap-1">
                {MINDMAP_BRANCH_COLORS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    role="menuitemradio"
                    aria-label={`Branch color ${c}`}
                    aria-checked={c === mindMapInfo.branchColor}
                    onClick={() => {
                      mindMapInfo.onBranchColorChange(c);
                      onClose();
                    }}
                    className={cn(
                      "focus-ring h-11 w-11 lg:h-6 lg:w-6 rounded border transition-transform",
                      c === mindMapInfo.branchColor
                        ? "border-foreground scale-110"
                        : "border-border",
                    )}
                    style={{ backgroundColor: c }}
                  />
                ))}
              </div>
            </div>
          </>
        )}
        {deleteItems.length > 0 && (
          <>
            <ActionMenuSeparator />
            {deleteItems.map(renderItem)}
          </>
        )}
      </ActionMenu>
    );
  }

  // Regular node context menu
  const editItems: MenuItem[] = [
    {
      label: "Duplicate",
      icon: CopySimple as MenuItem["icon"],
      action: () => {
        onDuplicate(nodeId);
        onClose();
      },
    },
    {
      label: "Delete",
      icon: Trash as MenuItem["icon"],
      action: () => {
        onDelete(nodeId);
        onClose();
      },
      variant: "destructive",
    },
  ];

  const orderItems: MenuItem[] = [
    {
      label: "Bring to Front",
      icon: ArrowLineUp as MenuItem["icon"],
      action: () => {
        onBringToFront(nodeId);
        onClose();
      },
    },
    {
      label: "Bring Forward",
      icon: ArrowUp as MenuItem["icon"],
      action: () => {
        onBringForward(nodeId);
        onClose();
      },
    },
    {
      label: "Send Backward",
      icon: ArrowDown as MenuItem["icon"],
      action: () => {
        onSendBackward(nodeId);
        onClose();
      },
    },
    {
      label: "Send to Back",
      icon: ArrowLineDown as MenuItem["icon"],
      action: () => {
        onSendToBack(nodeId);
        onClose();
      },
    },
  ];

  return (
    <ActionMenu
      open
      position={{ x, y }}
      onClose={onClose}
      label={mindMapInfo ? "Mind map actions" : "Canvas actions"}
    >
      {editItems.map(renderItem)}
      <ActionMenuSeparator />
      {orderItems.map(renderItem)}
    </ActionMenu>
  );
});
