import { useCallback, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { Hash, Lock, ChatTeardrop, NotePencil, Trash } from "@phosphor-icons/react";
import { useAppSelector, useAppDispatch } from "@/app/hooks";
import { cn } from "@/shared/utils/cn";
import { formatRelativeTime } from "@/shared/utils/dateFormatting";
import { stripMarkdownAndTruncate } from "@/features/search/utils/stripMarkdown";
import { setActiveChannel } from "@/features/chat/store/chatChannelsSlice";
import { setActiveThread } from "@/features/chat/store/chatThreadsSlice";
import { openThreadPanel } from "@/features/chat/store/chatUiSlice";
import { deleteDraftOnServer } from "@/features/chat/store/chatThunks";
import { selectDraftRows, type ChatDraftRow } from "@/features/chat/store/chatDraftsSlice";
import { getChannelDisplayName } from "@/features/chat/utils/channelDisplay";
import type { ChatChannel } from "@/features/chat/types";

const PREVIEW_LENGTH = 160;

function DraftRow({
  draft,
  channel,
  onOpen,
  onDiscard,
}: {
  draft: ChatDraftRow;
  channel: ChatChannel | undefined;
  onOpen: (draft: ChatDraftRow) => void;
  onDiscard: (draft: ChatDraftRow) => void;
}) {
  const isDm = channel?.channelType === "DIRECT" || channel?.channelType === "GROUP_DM";
  const isPrivate = channel?.channelType === "PRIVATE";
  const ChannelIcon = !channel || isDm ? ChatTeardrop : isPrivate ? Lock : Hash;
  const name = channel ? getChannelDisplayName(channel) : "Conversation";
  const preview = stripMarkdownAndTruncate(draft.content, PREVIEW_LENGTH);

  return (
    <div
      className="group flex items-start gap-1 border-b border-border/50 hover:bg-muted/30 transition-colors"
      data-testid={`chat-draft-row-${draft.key}`}
    >
      <button
        type="button"
        onClick={() => onOpen(draft)}
        className="flex flex-1 min-w-0 items-start gap-3 px-4 py-3 text-left"
      >
        <ChannelIcon size={16} className="text-muted-foreground shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-2">
            <span className="text-sm font-semibold text-foreground truncate">
              {channel && !isDm ? `#${name}` : name}
            </span>
            {draft.rootMessageId && (
              <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                Thread reply
              </span>
            )}
            <span className="ml-auto shrink-0 text-xs text-subtle-foreground">
              {formatRelativeTime(draft.updatedAt)}
            </span>
          </div>
          <p className="mt-0.5 text-sm text-muted-foreground line-clamp-2">{preview}</p>
        </div>
      </button>
      <button
        type="button"
        onClick={() => onDiscard(draft)}
        aria-label="Discard draft"
        title="Discard draft"
        className={cn(
          "mt-3 mr-3 shrink-0 rounded-lg p-1.5 text-muted-foreground transition-all",
          "hover:bg-red-500/10 hover:text-red-500 focus:opacity-100",
          "md:opacity-0 md:group-hover:opacity-100",
        )}
        data-testid={`chat-draft-discard-${draft.key}`}
      >
        <Trash size={16} />
      </button>
    </div>
  );
}

export function DraftsView() {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const drafts = useAppSelector(selectDraftRows);
  const channelsById = useAppSelector((state) => state.chatChannels.byId);

  const rows = useMemo(
    () => drafts.map((draft) => ({ draft, channel: channelsById[draft.channelId] })),
    [drafts, channelsById],
  );

  const handleOpen = useCallback(
    (draft: ChatDraftRow) => {
      dispatch(setActiveChannel(draft.channelId));
      if (draft.rootMessageId) {
        dispatch(setActiveThread(draft.rootMessageId));
        dispatch(openThreadPanel());
      }
      navigate(`/chat/${draft.channelId}`);
    },
    [dispatch, navigate],
  );

  const handleDiscard = useCallback(
    (draft: ChatDraftRow) => {
      dispatch(
        deleteDraftOnServer({
          channelId: draft.channelId,
          rootMessageId: draft.rootMessageId ?? undefined,
        }),
      );
    },
    [dispatch],
  );

  return (
    <div className="flex flex-col h-full" data-testid="chat-drafts-view">
      <div className="flex items-center justify-between px-4 py-2 border-b border-border bg-card">
        <span className="text-sm font-semibold text-foreground">Drafts</span>
        {drafts.length > 0 && (
          <span className="text-xs text-muted-foreground">
            {drafts.length} unsent {drafts.length === 1 ? "message" : "messages"}
          </span>
        )}
      </div>

      <div className="flex-1 overflow-y-auto">
        {rows.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <div className="text-center text-muted-foreground">
              <NotePencil size={48} className="mx-auto mb-3 text-muted-foreground/30" />
              <p className="text-lg font-semibold text-foreground">No drafts</p>
              <p className="text-sm mt-1">Messages you start but do not send appear here.</p>
            </div>
          </div>
        ) : (
          rows.map(({ draft, channel }) => (
            <DraftRow
              key={draft.key}
              draft={draft}
              channel={channel}
              onOpen={handleOpen}
              onDiscard={handleDiscard}
            />
          ))
        )}
      </div>
    </div>
  );
}
