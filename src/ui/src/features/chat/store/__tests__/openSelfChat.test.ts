import { configureStore } from "@reduxjs/toolkit";
import { create } from "@bufbuild/protobuf";
import { ChatChannelSchema, ChannelType } from "@uniffy/proto/chat/v1/chat_pb";
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ openSelfChat: vi.fn() }));

vi.mock("@/features/chat/api/chatApi", () => ({
  chatApi: { openSelfChat: mocks.openSelfChat },
}));

import { chatChannelsSlice, selectSelfDm } from "@/features/chat/store/chatChannelsSlice";
import { openSelfChat } from "@/features/chat/store/chatThunks";
import type { RootState } from "@/app/store";

function makeStore() {
  return configureStore({
    reducer: {
      auth: () => ({ currentOrganizationId: "organization-1", user: { id: "me" } }),
      chatChannels: chatChannelsSlice.reducer,
    },
  });
}

describe("openSelfChat", () => {
  it("stores the returned conversation once, however often it is opened", async () => {
    mocks.openSelfChat.mockResolvedValue({
      channel: create(ChatChannelSchema, {
        id: "self",
        name: "Ada Lovelace",
        ownerId: "me",
        channelType: ChannelType.DIRECT,
        dmMemberIds: ["me"],
        isSelfDm: true,
      }),
    });
    const store = makeStore();
    const getState = () => store.getState() as unknown as RootState;

    const first = await openSelfChat()(store.dispatch, getState, undefined);
    const second = await openSelfChat()(store.dispatch, getState, undefined);

    expect(mocks.openSelfChat).toHaveBeenCalledWith({ organizationId: "organization-1" });
    expect(first.payload).toMatchObject({ id: "self", isSelfDm: true });
    expect(second.payload).toMatchObject({ id: "self" });
    expect(store.getState().chatChannels.ids).toEqual(["self"]);
    expect(selectSelfDm(getState())?.id).toBe("self");
  });
});
