import { useAppSelector } from "@/app/hooks";
import { selectActiveChannel } from "@/features/chat/store/chatChannelsSlice";
import { CreateChannelModal } from "@/features/chat/components/modals/CreateChannelModal";
import { CreateCategoryModal } from "@/features/chat/components/modals/CreateCategoryModal";
import { BrowseChannelsModal } from "@/features/chat/components/modals/BrowseChannelsModal";
import { NewDmModal } from "@/features/chat/components/modals/NewDmModal";
import { ChannelSettingsModal } from "@/features/chat/components/modals/ChannelSettingsModal";
import { DmMembersModal } from "@/features/chat/components/modals/DmMembersModal";
import { AgentChatPickerModal } from "@/features/chat/components/modals/AgentChatPickerModal";
import { RenameAgentChatDialog } from "@/features/chat/components/modals/RenameAgentChatDialog";

// Dialog code loads with the chat route so opening one does not need another loading overlay.
export function ChatDialogs() {
  const activeChannel = useAppSelector(selectActiveChannel);
  const createChannelOpen = useAppSelector((state) => state.chatUi.createChannelModalOpen);
  const createCategoryOpen = useAppSelector((state) => state.chatUi.createCategoryModalOpen);
  const browseChannelsOpen = useAppSelector((state) => state.chatUi.browseChannelsModalOpen);
  const newDmOpen = useAppSelector((state) => state.chatUi.newDmModalOpen);
  const channelSettingsOpen = useAppSelector((state) => state.chatUi.channelSettingsModalOpen);
  const agentChatPickerOpen = useAppSelector((state) => state.chatUi.agentChatPickerOpen);
  const renameAgentChatChannelId = useAppSelector((state) => state.chatUi.renameAgentChatChannelId);

  return (
    <>
      {createChannelOpen && <CreateChannelModal />}
      {createCategoryOpen && <CreateCategoryModal />}
      {browseChannelsOpen && <BrowseChannelsModal />}
      {newDmOpen && <NewDmModal />}
      {channelSettingsOpen &&
        (activeChannel?.channelType === "DIRECT" || activeChannel?.channelType === "GROUP_DM" ? (
          <DmMembersModal />
        ) : (
          <ChannelSettingsModal />
        ))}
      {agentChatPickerOpen && <AgentChatPickerModal />}
      {renameAgentChatChannelId && <RenameAgentChatDialog />}
    </>
  );
}
