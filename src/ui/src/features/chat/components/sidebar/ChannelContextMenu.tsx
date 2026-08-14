import { useState, useEffect, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
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
} from "@phosphor-icons/react";
import { useAppDispatch, useAppSelector } from "@/app/hooks";
import {
  setSplitChannel,
  selectChannelById,
  selectActiveChannelId,
  selectAgentFolders,
} from "@/features/chat/store/chatChannelsSlice";
import { activateSplit, openRenameAgentChatDialog } from "@/features/chat/store/chatUiSlice";
import { selectChannelPreferences } from "@/features/chat/store/chatChannelsSlice";
import { deleteChannel, leaveChannel, setAgentChatFolder } from "@/features/chat/store/chatThunks";
import { ChannelNotificationMenu } from "@/features/chat/components/sidebar/ChannelNotificationMenu";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { getChannelDisplayName } from "@/features/chat/utils/channelDisplay";

interface ChannelContextMenuProps {
  channelId: string;
  position: { x: number; y: number };
  onClose: () => void;
}

export function ChannelContextMenu({ channelId, position, onClose }: ChannelContextMenuProps) {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const menuRef = useRef<HTMLDivElement>(null);
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

  const isGroupDm = channel?.channelType === "GROUP_DM";
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

  useEffect(() => {
    if (confirmDeleteOpen || confirmLeaveOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const timer = setTimeout(() => {
      document.addEventListener("mousedown", handleClick);
    }, 0);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("mousedown", handleClick);
    };
  }, [onClose, confirmDeleteOpen, confirmLeaveOpen]);

  useEffect(() => {
    if (confirmDeleteOpen || confirmLeaveOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose, confirmDeleteOpen, confirmLeaveOpen]);

  const handleOpenInSplit = useCallback(() => {
    dispatch(setSplitChannel(channelId));
    dispatch(activateSplit());
    onClose();
  }, [dispatch, channelId, onClose]);

  const menuStyle = {
    top: position.y,
    left: position.x,
  };

  const MuteIcon = isMuted ? SpeakerHigh : SpeakerSlash;
  const btnClass =
    "flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-accent cursor-pointer w-full text-left transition-colors text-foreground";

  const channelName = channel ? getChannelDisplayName(channel) : "this chat";

  return (
    <>
      <div
        ref={menuRef}
        className="fixed z-50 bg-card border border-border rounded-lg shadow-xl py-1 min-w-[180px]"
        style={menuStyle}
      >
        <button type="button" onClick={handleOpenInSplit} className={btnClass}>
          <SquareSplitHorizontal size={16} className="text-muted-foreground" />
          <span>Open in Split View</span>
        </button>

        {isAgentDm && (
          <>
            <div className="my-1 h-px bg-border mx-2" />
            {agentFolders.length > 0 && (
              <div
                className="relative"
                onMouseEnter={() => setShowFolderMenu(true)}
                onMouseLeave={() => setShowFolderMenu(false)}
              >
                <button
                  type="button"
                  onClick={() => setShowFolderMenu((v) => !v)}
                  className={btnClass}
                  data-testid="chat-channel-context-menu-move-to-folder"
                >
                  <FolderSimple size={16} className="text-muted-foreground" />
                  <span className="flex-1">Move to folder</span>
                  <CaretRight size={12} className="text-muted-foreground" />
                </button>
                {showFolderMenu && (
                  <div className="absolute left-full top-0 ml-0.5 z-50 bg-card border border-border rounded-lg shadow-xl py-1 min-w-[170px] max-h-64 overflow-y-auto">
                    {agentFolders.map((folder) => (
                      <button
                        key={folder.id}
                        type="button"
                        onClick={() => handleMoveToFolder(folder.id)}
                        className={btnClass}
                        data-testid={`chat-channel-context-menu-folder-${folder.id}`}
                      >
                        <FolderSimple size={14} className="text-muted-foreground" />
                        <span className="flex-1 truncate">{folder.name}</span>
                        {channel?.agentFolderId === folder.id && (
                          <Check size={12} className="text-primary" />
                        )}
                      </button>
                    ))}
                    {channel?.agentFolderId && (
                      <>
                        <div className="my-1 h-px bg-border mx-2" />
                        <button
                          type="button"
                          onClick={() => handleMoveToFolder(null)}
                          className={btnClass}
                          data-testid="chat-channel-context-menu-unfile"
                        >
                          <FolderSimpleMinus size={14} className="text-muted-foreground" />
                          <span>Remove from folder</span>
                        </button>
                      </>
                    )}
                  </div>
                )}
              </div>
            )}
            <button
              type="button"
              onClick={handleRename}
              className={btnClass}
              data-testid="chat-channel-context-menu-rename"
            >
              <PencilSimple size={16} className="text-muted-foreground" />
              <span>Rename chat</span>
            </button>
            <button
              type="button"
              onClick={handleDeleteClick}
              className="flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-accent cursor-pointer w-full text-left transition-colors text-red-500 hover:text-red-500"
              data-testid="chat-channel-context-menu-delete"
            >
              <Trash size={16} />
              <span>Delete chat</span>
            </button>
          </>
        )}

        <div className="my-1 h-px bg-border mx-2" />

        <button
          type="button"
          onClick={() => setShowNotificationMenu(!showNotificationMenu)}
          className={btnClass}
        >
          <MuteIcon size={16} className="text-muted-foreground" />
          <span className="flex-1">{isMuted ? "Muted" : "Notification settings"}</span>
          <CaretRight size={12} className="text-muted-foreground" />
        </button>

        {showNotificationMenu && (
          <>
            <div className="my-1 h-px bg-border mx-2" />
            <ChannelNotificationMenu channelId={channelId} onClose={onClose} />
          </>
        )}

        {canLeave && (
          <>
            <div className="my-1 h-px bg-border mx-2" />
            <button
              type="button"
              onClick={() => setConfirmLeaveOpen(true)}
              className="flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-accent cursor-pointer w-full text-left transition-colors text-red-500 hover:text-red-500"
              data-testid="chat-channel-context-menu-leave"
            >
              <SignOut size={16} />
              <span>{isGroupDm ? "Leave conversation" : "Leave channel"}</span>
            </button>
          </>
        )}
      </div>

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
