import { createAsyncThunk } from "@reduxjs/toolkit";
import { sessionsApi } from "@/features/agents/api/sessionsApi";
import { runtimeApi } from "@/features/agents/api/runtimeApi";
import type { RootState, AppDispatch } from "@/app/store";
import { MessageRole } from "@uniffy/proto/agents/v1/sessions_pb";
import {
  streamStarted,
  addOptimisticUserMessage,
  clearConfirmation,
  streamError,
} from "@/features/agents/store/agentMessagesSlice";
import { createAgentStreamConsumer } from "@/features/agents/store/agentStreamFold";
import { messageToPlain } from "@/features/agents/store/agentMessagesSerde";
import type { SerializedMessage } from "@/features/agents/store/agentMessagesSerde";

export { messageToPlain };
export type { SerializedMessage };

const getOrganizationId = (state: RootState): string => {
  const orgId = state.auth.currentOrganizationId;
  if (!orgId) throw new Error("No organization selected");
  return orgId;
};

export const fetchMessages = createAsyncThunk<
  { sessionId: string; messages: SerializedMessage[] },
  { sessionId: string },
  { state: RootState; rejectValue: string }
>("agentMessages/fetchMessages", async (params, { getState, rejectWithValue }) => {
  try {
    const organizationId = getOrganizationId(getState());

    // Backend caps page size at 200; compaction keeps active messages well under that.
    const first = await sessionsApi.listMessages({
      organizationId,
      sessionId: params.sessionId,
      pagination: { page: 1, pageSize: 200 },
    });
    const allMessages = first.messages.map(messageToPlain);
    const totalPages = first.pagination?.totalPages ?? 1;

    for (let page = 2; page <= totalPages; page++) {
      const next = await sessionsApi.listMessages({
        organizationId,
        sessionId: params.sessionId,
        pagination: { page, pageSize: 200 },
      });
      allMessages.push(...next.messages.map(messageToPlain));
    }

    return {
      sessionId: params.sessionId,
      messages: allMessages,
    };
  } catch (error) {
    return rejectWithValue(error instanceof Error ? error.message : "Failed to fetch messages");
  }
});

export const streamSendMessage = createAsyncThunk<
  void,
  {
    sessionId: string;
    content: string;
    fileIds?: string[];
    invokedSkillId?: string;
    invokedSkillName?: string;
  },
  { state: RootState; rejectValue: string }
>("agentMessages/streamSendMessage", async (params, { getState, dispatch, rejectWithValue }) => {
  try {
    const organizationId = getOrganizationId(getState());
    dispatch(streamStarted());
    dispatch(
      addOptimisticUserMessage({
        sessionId: params.sessionId,
        content: params.content,
        fileIds: params.fileIds,
        invokedSkillName: params.invokedSkillName,
      }),
    );

    const stream = runtimeApi.streamSendMessage({
      organizationId,
      sessionId: params.sessionId,
      content: params.content,
      fileIds: params.fileIds ?? [],
      userTimezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      invokedSkillId: params.invokedSkillId,
    });

    const consumer = createAgentStreamConsumer(dispatch as AppDispatch, params.sessionId);
    try {
      for await (const envelope of stream) {
        const outcome = consumer.handle(envelope);
        if (outcome?.status === "error") {
          return rejectWithValue(outcome.errorMessage ?? "Streaming failed");
        }
        if (outcome) return;
      }
    } finally {
      consumer.dispose();
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Streaming failed";
    dispatch(streamError(msg));
    return rejectWithValue(msg);
  }
});

export const rerunFromMessage = createAsyncThunk<
  void,
  { sessionId: string; messageId: string },
  { state: RootState; rejectValue: string }
>("agentMessages/rerunFromMessage", async (params, { getState, dispatch, rejectWithValue }) => {
  try {
    const organizationId = getOrganizationId(getState());
    dispatch(streamStarted());

    const stream = runtimeApi.rerunFromMessage({
      organizationId,
      messageId: params.messageId,
      userTimezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    });

    const consumer = createAgentStreamConsumer(dispatch as AppDispatch, params.sessionId);
    try {
      for await (const envelope of stream) {
        const outcome = consumer.handle(envelope);
        if (outcome?.status === "error") {
          return rejectWithValue(outcome.errorMessage ?? "Rerun failed");
        }
        if (outcome) return;
      }
    } finally {
      consumer.dispose();
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Rerun failed";
    dispatch(streamError(msg));
    return rejectWithValue(msg);
  }
});

export const cancelActiveRun = createAsyncThunk<
  void,
  void,
  { state: RootState; rejectValue: string }
>("agentMessages/cancelActiveRun", async (_, { getState, rejectWithValue }) => {
  try {
    const state = getState();
    const organizationId = getOrganizationId(state);
    const runId = state.agentMessages.activeRunId;
    if (!runId) return;
    await runtimeApi.cancelStream({ organizationId, runId });
  } catch (error) {
    return rejectWithValue(error instanceof Error ? error.message : "Failed to cancel run");
  }
});

export const editAgentMessage = createAsyncThunk<
  {
    sessionId: string;
    updated: SerializedMessage;
    anchorCreatedAt?: { seconds: number; nanos: number };
  },
  { sessionId: string; messageId: string; newContent: string },
  { state: RootState; rejectValue: string }
>("agentMessages/editMessage", async (params, { getState, rejectWithValue }) => {
  try {
    const organizationId = getOrganizationId(getState());
    const resp = await sessionsApi.editMessage({
      organizationId,
      messageId: params.messageId,
      newContent: params.newContent,
    });
    if (!resp.message) throw new Error("Empty edit response");
    const updated = messageToPlain(resp.message);
    return {
      sessionId: params.sessionId,
      updated,
      anchorCreatedAt: updated.createdAt,
    };
  } catch (error) {
    return rejectWithValue(error instanceof Error ? error.message : "Failed to edit message");
  }
});

export const retryAgentMessage = createAsyncThunk<
  { sessionId: string; content: string; fileIds: string[]; anchorMessageId: string },
  { sessionId: string; messageId: string },
  { state: RootState; rejectValue: string }
>("agentMessages/retryMessage", async (params, { getState, rejectWithValue }) => {
  try {
    const organizationId = getOrganizationId(getState());
    const resp = await sessionsApi.retryMessage({
      organizationId,
      messageId: params.messageId,
    });
    return {
      sessionId: params.sessionId,
      content: resp.content,
      fileIds: [...resp.fileIds],
      anchorMessageId: params.messageId,
    };
  } catch (error) {
    return rejectWithValue(error instanceof Error ? error.message : "Failed to retry message");
  }
});

export const respondToConfirmation = createAsyncThunk<
  void,
  { sessionId: string; toolCallId: string; approved: boolean },
  { state: RootState; rejectValue: string }
>(
  "agentMessages/respondToConfirmation",
  async (params, { getState, dispatch, rejectWithValue }) => {
    try {
      const organizationId = getOrganizationId(getState());
      dispatch(clearConfirmation());
      await runtimeApi.respondToConfirmation({
        organizationId,
        sessionId: params.sessionId,
        toolCallId: params.toolCallId,
        approved: params.approved,
      });
    } catch (error) {
      return rejectWithValue(
        error instanceof Error ? error.message : "Failed to respond to confirmation",
      );
    }
  },
);

export { MessageRole };
