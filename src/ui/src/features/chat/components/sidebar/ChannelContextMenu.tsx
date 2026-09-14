import { useState, useCallback } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  SquareSplitHorizontal,
  SpeakerSlash,
  SpeakerHigh,
  CaretRight,
  PencilSimple,
  Trash,
  FolderSimple,
  FolderSimpleMinus,
  Check,
  SignOut,
  Archive,
  ArrowLineUp,
} from "@phosphor-icons/react";
import { useAppDispatch, useAppSelector } from "@/app/hooks";
import {
  setSplitChannel,
  setActiveChannel,
  selectChannelById,
  selectActiveChannelId,
  selectAgentFolders,
} from "@/features/chat/store/chatChannelsSlice";
import { activateSplit, openRenameAgentChatDialog } from "@/features/chat/store/chatUiSlice";
import { selectChannelPreferences } from "@/features/chat/store/chatChannelsSlice";
import {
  archiveChannel,
  deleteChannel,
  leaveChannel,
  setAgentChatFolder,
  jumpToFirstUnread,
} from "@/features/chat/store/chatThunks";
import { useChatPermissions } from "@/features/chat/hooks/useChatPermissions";
import { ChannelNotificationMenu } from "@/features/chat/components/sidebar/ChannelNotificationMenu";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { ActionMenu, ActionMenuItem, ActionMenuSeparator } from "@/components/ui/action-menu";
import { cn } from "@/shared/utils/cn";
import { getChannelDisplayName } from "@/features/chat/utils/channelDisplay";

interface ChannelContextMenuProps {
  channelId: string;
  position: { x: number; y: number };
  onClose: () => void;
}

export function ChannelContextMenu({ channelId, position, onClose }: ChannelContextMenuProps) {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const location = useLocation();
  const currentUserId = useAppSelector((state) => state.auth.user?.id ?? "");
  const prefs = useAppSelector(selectChannelPreferences);
  const members = useAppSelector((state) => state.chatChannels.channelMembers[channelId]);
  const memberMuted = members?.find((m) => m.userId === currentUserId)?.isMuted ?? false;
  const isMuted = prefs[channelId]?.isMuted ?? memberMuted;
  const channel = useAppSelector((state) => selectChannelById(state, channelId));
  const activeChannelId = useAppSelector(selectActiveChannelId);
  const isAgentDm = !!channel?.isAgentDm;
  const agentFolders = useAppSelector(selectAgentFolders);
  const [showNotificationMenu, setShowNotificationMenu] = useState(false);
  const [showFolderMenu, setShowFolderMenu] = useState(false);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [confirmLeaveOpen, setConfirmLeaveOpen] = useState(false);
  const [isLeaving, setIsLeaving] = useState(false);
  const [confirmArchiveOpen, setConfirmArchiveOpen] = useState(false);
  const [isArchiving, setIsArchiving] = useState(false);
  const { canManageChat } = useChatPermissions();

  const isGroupDm = channel?.channelType === "GROUP_DM";
  // Mirrors the backend delete gate: channel owner, org admin, or chat domain admin.
  const canArchive =
    !!channel &&
    !isAgentDm &&
    !channel.isDefault &&
    channel.channelType !== "DIRECT" &&
    !isGroupDm &&
    (canManageChat || channel.currentUserRole === "OWNER");
  const canLeave =
    !!channel && !isAgentDm && channel.channelType !== "DIRECT" && !channel.isDefault;

  const handleConfirmLeave = useCallback(async () => {
    setIsLeaving(true);
    try {
      await dispatch(leaveChannel(channelId)).unwrap();
      if (activeChannelId === channelId) {
        navigate("/chat");
      }
      setConfirmLeaveOpen(false);
      onClose();
    } catch {
      // Rejection reaches the user through the global error toast.
      setConfirmLeaveOpen(false);
      onClose();
    } finally {
      setIsLeaving(false);
    }
  }, [dispatch, channelId, activeChannelId, navigate, onClose]);

  const handleMoveToFolder = useCallback(
    (folderId: string | null) => {
      dispatch(setAgentChatFolder({ channelId, folderId }));
      onClose();
    },
    [dispatch, channelId, onClose],
  );

  const handleRename = useCallback(() => {
    dispatch(openRenameAgentChatDialog(channelId));
    onClose();
  }, [dispatch, channelId, onClose]);

  const handleDeleteClick = useCallback(() => {
    setConfirmDeleteOpen(true);
  }, []);

  const handleConfirmDelete = useCallback(async () => {
    setIsDeleting(true);
    try {
      await dispatch(deleteChannel(channelId)).unwrap();
      if (activeChannelId === channelId) {
        navigate("/chat");
      }
      setConfirmDeleteOpen(false);
      onClose();
    } finally {
      setIsDeleting(false);
    }
    // The deps below ARE read in the body; oxlint's memo analysis misses reads
    // inside try/finally blocks and object-literal call arguments.
    // eslint-disable-next-line react/react-compiler
  }, [dispatch, channelId, activeChannelId, navigate, onClose]);

  const handleOpenInSplit = useCallback(() => {
    dispatch(setSplitChannel(channelId));
    dispatch(activateSplit());
    onClose();
  }, [dispatch, channelId, onClose]);

  const hasUnread = (channel?.unreadCount ?? 0) > 0;

  const handleJumpToFirstUnread = useCallback(() => {
    // activeChannelId survives leaving the channel route, so the route decides
    // whether a message list is mounted to receive the jump.
    if (location.pathname !== `/chat/${channelId}`) {
      dispatch(setActiveChannel(channelId));
      navigate(`/chat/${channelId}`);
    }
    void dispatch(jumpToFirstUnread({ channelId }));
    onClose();
  }, [dispatch, channelId, location.pathname, navigate, onClose]);

  const MuteIcon = isMuted ? SpeakerHigh : SpeakerSlash;

  const handleConfirmArchive = useCallback(async () => {
    setIsArchiving(true);
    try {
      await dispatch(archiveChannel(channelId)).unwrap();
      setConfirmArchiveOpen(false);
      onClose();
      if (activeChannelId === channelId) navigate("/chat");
    } finally {
      setIsArchiving(false);
    }
    // The deps below ARE read in the body; oxlint's memo analysis misses reads
    // inside try/finally blocks and object-literal call arguments.
    // eslint-disable-next-line react/react-compiler
  }, [dispatch, channelId, activeChannelId, navigate, onClose]);

  const channelName = channel ? getChannelDisplayName(channel) : "this chat";

  return (
    <>
      <ActionMenu
        open={!confirmDeleteOpen && !confirmLeaveOpen && !confirmArchiveOpen}
        position={position}
        onClose={onClose}
        label="Chat actions"
        className="w-64"
      >
        <ActionMenuItem type="button" onClick={handleOpenInSplit}>
          <SquareSplitHorizontal size={16} className="text-muted-foreground" />
          <span>Open in Split View</span>
        </ActionMenuItem>

        {hasUnread && (
          <ActionMenuItem
            type="button"
            onClick={handleJumpToFirstUnread}
            data-testid="chat-channel-context-menu-jump-unread"
          >
            <ArrowLineUp size={16} className="text-muted-foreground" />
            <span>Jump to first unread</span>
          </ActionMenuItem>
        )}

        {isAgentDm && (
          <>
            <ActionMenuSeparator />
            {agentFolders.length > 0 && (
              <div className="relative">
                <ActionMenuItem
                  type="button"
                  aria-expanded={showFolderMenu}
                  onClick={() => setShowFolderMenu((v) => !v)}

                  data-testid="chat-channel-context-menu-move-to-folder"
                >
                  <FolderSimple size={16} className="text-muted-foreground" />
                  <span className="flex-1">Move to folder</span>
                  <CaretRight
                    size={12}
                    className={cn(
                      "text-muted-foreground transition-transform",
                      showFolderMenu && "rotate-90",
                    )}
                  />
                </ActionMenuItem>
                {showFolderMenu && (
                  <div
                    role="group"
                    aria-label="Move to folder"
                    className="ml-3 border-l border-border/60 pl-1"
                  >
                    {agentFolders.map((folder) => (
                      <ActionMenuItem
                        key={folder.id}
                        type="button"
                        onClick={() => handleMoveToFolder(folder.id)}

                        data-testid={`chat-channel-context-menu-folder-${folder.id}`}
                      >
                        <FolderSimple size={14} className="text-muted-foreground" />
                        <span className="flex-1 truncate">{folder.name}</span>
                        {channel?.agentFolderId === folder.id && (
                          <Check size={12} className="text-primary" />
                        )}
                      </ActionMenuItem>
                    ))}
                    {channel?.agentFolderId && (
                      <>
                        <ActionMenuSeparator />
                        <ActionMenuItem
                          type="button"
                          onClick={() => handleMoveToFolder(null)}

                          data-testid="chat-channel-context-menu-unfile"
                        >
                          <FolderSimpleMinus size={14} className="text-muted-foreground" />
                          <span>Remove from folder</span>
                        </ActionMenuItem>
                      </>
                    )}
                  </div>
                )}
              </div>
            )}
            <ActionMenuItem
              type="button"
              onClick={handleRename}
              data-testid="chat-channel-context-menu-rename"
            >
              <PencilSimple size={16} className="text-muted-foreground" />
              <span>Rename chat</span>
            </ActionMenuItem>
            <ActionMenuItem
              type="button"
              onClick={handleDeleteClick}
              destructive
              data-testid="chat-channel-context-menu-delete"
            >
              <Trash size={16} />
              <span>Delete chat</span>
            </ActionMenuItem>
          </>
        )}

        <ActionMenuSeparator />

        <ActionMenuItem
          type="button"
          aria-expanded={showNotificationMenu}
          onClick={() => setShowNotificationMenu(!showNotificationMenu)}
        >
          <MuteIcon size={16} className="text-muted-foreground" />
          <span className="flex-1">{isMuted ? "Muted" : "Notification settings"}</span>
          <CaretRight size={12} className="text-muted-foreground" />
        </ActionMenuItem>

        {showNotificationMenu && (
          <>
            <ActionMenuSeparator />
            <ChannelNotificationMenu channelId={channelId} onClose={onClose} />
          </>
        )}

        {canArchive && (
          <>
            <ActionMenuSeparator />
            <ActionMenuItem
              type="button"
              onClick={() => setConfirmArchiveOpen(true)}
              data-testid="chat-channel-context-menu-archive"
            >
              <Archive size={16} className="text-muted-foreground" />
              <span>Archive channel</span>
            </ActionMenuItem>
          </>
        )}

        {canLeave && (
          <>
            <ActionMenuSeparator />
            <ActionMenuItem
              type="button"
              onClick={() => setConfirmLeaveOpen(true)}
              destructive
              data-testid="chat-channel-context-menu-leave"
            >
              <SignOut size={16} />
              <span>{isGroupDm ? "Leave conversation" : "Leave channel"}</span>
            </ActionMenuItem>
          </>
        )}
      </ActionMenu>

      <ConfirmDialog
        isOpen={confirmDeleteOpen}
        onClose={() => setConfirmDeleteOpen(false)}
        onConfirm={handleConfirmDelete}
        title="Delete chat"
        message={`Delete "${channelName}"? This permanently removes the conversation and its messages. This cannot be undone.`}
        confirmLabel="Delete"
        variant="danger"
        loading={isDeleting}
      />

      <ConfirmDialog
        isOpen={confirmArchiveOpen}
        onClose={() => setConfirmArchiveOpen(false)}
        onConfirm={handleConfirmArchive}
        title="Archive channel"
        message={`Archive "${channelName}"? Members keep the history and an owner or admin can restore it from the Archived section.`}
        confirmLabel="Archive"
        loading={isArchiving}
      />

      <ConfirmDialog
        isOpen={confirmLeaveOpen}
        onClose={() => setConfirmLeaveOpen(false)}
        onConfirm={handleConfirmLeave}
        title={isGroupDm ? "Leave conversation" : "Leave channel"}
        message={
          isGroupDm
            ? `Leave "${channelName}"? You'll need to be re-added to rejoin.`
            : channel?.channelType === "PUBLIC"
              ? `Leave "${channelName}"? You can rejoin from Browse channels anytime.`
              : `Leave "${channelName}"? You'll need to be re-invited to rejoin.`
        }
        confirmLabel="Leave"
        variant="danger"
        loading={isLeaving}
      />
    </>
  );
}
