import { useState, useCallback, useRef, useEffect, type ReactNode } from "react";
import { CaretDown, CaretRight, Folder, PencilSimple, Trash } from "@phosphor-icons/react";
import { useDroppable } from "@dnd-kit/core";
import { useAppDispatch } from "@/app/hooks";
import { cn } from "@/shared/utils/cn";
import { renameAgentFolder, deleteAgentFolder } from "@/features/chat/store/chatThunks";
import { toggleAgentFolderCollapsed } from "@/features/chat/store/chatUiSlice";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import type { ChatAgentFolder } from "@/features/chat/types";

interface AgentChatFolderGroupProps {
  folder: ChatAgentFolder;
  collapsed: boolean;
  chatCount: number;
  children: ReactNode;
}

export function AgentChatFolderGroup({
  folder,
  collapsed,
  chatCount,
  children,
}: AgentChatFolderGroupProps) {
  const dispatch = useAppDispatch();
  const [renaming, setRenaming] = useState(false);
  const [draftName, setDraftName] = useState(folder.name);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const { setNodeRef, isOver } = useDroppable({ id: `agent-folder:${folder.id}` });

  useEffect(() => {
    if (renaming) inputRef.current?.select();
  }, [renaming]);

  const handleToggle = useCallback(() => {
    dispatch(toggleAgentFolderCollapsed(folder.id));
  }, [dispatch, folder.id]);

  const handleStartRename = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      setDraftName(folder.name);
      setRenaming(true);
    },
    [folder.name],
  );

  const handleCommitRename = useCallback(() => {
    const clean = draftName.trim();
    setRenaming(false);
    if (clean && clean !== folder.name) {
      dispatch(renameAgentFolder({ folderId: folder.id, name: clean }));
    }
  }, [dispatch, draftName, folder.id, folder.name]);

  const handleDelete = useCallback(async () => {
    await dispatch(deleteAgentFolder(folder.id));
    setConfirmDeleteOpen(false);
  }, [dispatch, folder.id]);

  return (
    <div
      ref={setNodeRef}
      data-testid={`chat-sidebar-agent-folder-${folder.id}`}
      data-state={collapsed ? "collapsed" : "expanded"}
      className={cn(
        "rounded-md mx-1.5 max-w-[calc(100%-12px)] transition-colors",
        isOver && "bg-primary/10 ring-2 ring-primary",
      )}
    >
      <div className="group/folder flex items-center gap-2 px-2 py-1.5 text-sm rounded-md hover:bg-accent transition-colors">
        {renaming ? (
          <input
            ref={inputRef}
            value={draftName}
            onChange={(e) => setDraftName(e.target.value)}
            onBlur={handleCommitRename}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleCommitRename();
              if (e.key === "Escape") setRenaming(false);
            }}
            className="flex-1 min-w-0 bg-input border border-border rounded px-1.5 py-1 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
            data-testid={`chat-sidebar-agent-folder-rename-input-${folder.id}`}
          />
        ) : (
          <>
            <button
              type="button"
              onClick={handleToggle}
              className="flex items-center gap-2 flex-1 min-w-0 text-left cursor-pointer"
              data-testid={`chat-sidebar-agent-folder-toggle-${folder.id}`}
            >
              {collapsed ? (
                <CaretRight size={14} weight="bold" className="text-muted-foreground shrink-0" />
              ) : (
                <CaretDown size={14} weight="bold" className="text-muted-foreground shrink-0" />
              )}
              <Folder size={16} weight="duotone" className="text-muted-foreground shrink-0" />
              <span className="flex-1 truncate text-foreground/90">{folder.name}</span>
            </button>
            <button
              type="button"
              onClick={handleStartRename}
              aria-label="Rename folder"
              className="p-1 rounded text-muted-foreground opacity-0 group-hover/folder:opacity-100 focus:opacity-100 hover:text-foreground transition-opacity"
              data-testid={`chat-sidebar-agent-folder-rename-${folder.id}`}
            >
              <PencilSimple size={13} />
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setConfirmDeleteOpen(true);
              }}
              aria-label="Delete folder"
              className="p-1 rounded text-muted-foreground opacity-0 group-hover/folder:opacity-100 focus:opacity-100 hover:text-red-500 transition-opacity"
              data-testid={`chat-sidebar-agent-folder-delete-${folder.id}`}
            >
              <Trash size={13} />
            </button>
          </>
        )}
      </div>

      {!collapsed && chatCount > 0 && (
        <div className="ml-3 pl-2 border-l border-border space-y-0.5 mt-0.5 pb-0.5">{children}</div>
      )}

      <ConfirmDialog
        isOpen={confirmDeleteOpen}
        onClose={() => setConfirmDeleteOpen(false)}
        onConfirm={handleDelete}
        title="Delete folder"
        message={`Delete "${folder.name}"? The chats inside are kept and move back to Agent Chats.`}
        confirmLabel="Delete"
        variant="danger"
      />
    </div>
  );
}
