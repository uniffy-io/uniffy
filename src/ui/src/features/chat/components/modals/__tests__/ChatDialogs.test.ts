import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Provider } from "react-redux";
import { configureStore } from "@reduxjs/toolkit";
import { create } from "@bufbuild/protobuf";
import { ChatChannelSchema, ChannelType } from "@uniffy/proto/chat/v1/chat_pb";
import { describe, expect, it, vi } from "vitest";
import { channelToPlain } from "@/features/chat/api/chatConverters";
import {
  addChannel,
  chatChannelsReducer,
  setActiveChannel,
} from "@/features/chat/store/chatChannelsSlice";
import {
  chatUiReducer,
  closeChannelSettingsModal,
  openAgentChatPicker,
  openBrowseChannelsModal,
  openChannelSettingsModal,
  openCreateCategoryModal,
  openCreateChannelModal,
  openNewDmModal,
  openRenameAgentChatDialog,
} from "@/features/chat/store/chatUiSlice";
import { ChatDialogs } from "@/features/chat/components/modals/ChatDialogs";

vi.mock("@/features/chat/components/modals/CreateChannelModal", () => ({
  CreateChannelModal: () => "Create channel",
}));
vi.mock("@/features/chat/components/modals/CreateCategoryModal", () => ({
  CreateCategoryModal: () => "Create category",
}));
vi.mock("@/features/chat/components/modals/BrowseChannelsModal", () => ({
  BrowseChannelsModal: () => "Browse channels",
}));
vi.mock("@/features/chat/components/modals/NewDmModal", () => ({
  NewDmModal: () => "New DM",
}));
vi.mock("@/features/chat/components/modals/ChannelSettingsModal", () => ({
  ChannelSettingsModal: () => "Channel settings",
}));
vi.mock("@/features/chat/components/modals/DmMembersModal", () => ({
  DmMembersModal: () => "DM members",
}));
vi.mock("@/features/chat/components/modals/AgentChatPickerModal", () => ({
  AgentChatPickerModal: () => "Agent picker",
}));
vi.mock("@/features/chat/components/modals/RenameAgentChatDialog", () => ({
  RenameAgentChatDialog: () => "Rename agent chat",
}));

function makeStore(channelType = ChannelType.PUBLIC) {
  const store = configureStore({
    reducer: { chatChannels: chatChannelsReducer, chatUi: chatUiReducer },
  });
  store.dispatch(
    addChannel(channelToPlain(create(ChatChannelSchema, { id: "chat", channelType }))),
  );
  store.dispatch(setActiveChannel("chat"));
  return store;
}

function renderDialogs(store: ReturnType<typeof makeStore>) {
  // Synchronous rendering fails if opening a dialog still needs an unresolved lazy import.
  return renderToStaticMarkup(
    createElement(Provider, { store, children: createElement(ChatDialogs) }),
  );
}

describe("ChatDialogs", () => {
  it("keeps closed dialogs unmounted", () => {
    expect(renderDialogs(makeStore())).toBe("");
  });

  it.each([
    ["Create channel", openCreateChannelModal(null), ChannelType.PUBLIC],
    ["Create category", openCreateCategoryModal(), ChannelType.PUBLIC],
    ["Browse channels", openBrowseChannelsModal(), ChannelType.PUBLIC],
    ["New DM", openNewDmModal(), ChannelType.PUBLIC],
    ["Channel settings", openChannelSettingsModal("overview"), ChannelType.PUBLIC],
    ["Channel settings", openChannelSettingsModal("members"), ChannelType.PRIVATE],
    ["DM members", openChannelSettingsModal("members"), ChannelType.GROUP_DM],
    ["DM members", openChannelSettingsModal("overview"), ChannelType.DIRECT],
    ["Agent picker", openAgentChatPicker(), ChannelType.PUBLIC],
    ["Rename agent chat", openRenameAgentChatDialog("chat"), ChannelType.DIRECT],
  ] as const)(
    "renders %s on first open without waiting for code",
    (content, action, channelType) => {
      const store = makeStore(channelType);
      store.dispatch(action);

      expect(renderDialogs(store)).toBe(content);
    },
  );

  it("opens the matching dialog after switching conversations", () => {
    const store = makeStore();
    store.dispatch(openChannelSettingsModal("members"));
    expect(renderDialogs(store)).toBe("Channel settings");

    store.dispatch(closeChannelSettingsModal());
    expect(renderDialogs(store)).toBe("");
    store.dispatch(
      addChannel(
        channelToPlain(create(ChatChannelSchema, { id: "dm", channelType: ChannelType.GROUP_DM })),
      ),
    );
    store.dispatch(setActiveChannel("dm"));
    store.dispatch(openChannelSettingsModal("members"));
    expect(renderDialogs(store)).toBe("DM members");

    store.dispatch(closeChannelSettingsModal());
    store.dispatch(setActiveChannel("chat"));
    store.dispatch(openChannelSettingsModal("overview"));
    expect(renderDialogs(store)).toBe("Channel settings");
  });
});
