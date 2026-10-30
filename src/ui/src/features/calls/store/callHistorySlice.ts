import { createAsyncThunk, createSlice } from "@reduxjs/toolkit";
import { removeChannel } from "@/features/chat/store/chatChannelsSlice";
import { callsApi } from "@/features/calls/api/callsApi";
import {
  historyRecordToPlain,
  historyPersonToPlain,
  type CallHistoryRecord,
  type CallHistoryPerson,
} from "@/features/calls/api/historyConverters";

export interface HistoryScope {
  organizationId: string;
  channelId?: string;
  callId?: string;
}
export const historyScopeKey = (scope: HistoryScope) => JSON.stringify(scope);
export const fetchCallHistory = createAsyncThunk(
  "callHistory/fetch",
  async (args: HistoryScope & { cursor?: string }) => {
    if (args.callId) {
      const response = await callsApi.getCallRecord({
        organizationId: args.organizationId,
        callId: args.callId,
        participantCursor: args.cursor,
        pageSize: 50,
      });
      if (!response.record) throw new Error("Call unavailable");
      return {
        records: [historyRecordToPlain(response.record)],
        people: response.participants.map(historyPersonToPlain),
        cursor: response.nextParticipantCursor,
      };
    }
    const response = await callsApi.listCallHistory({
      organizationId: args.organizationId,
      channelId: args.channelId,
      cursor: args.cursor,
      pageSize: 50,
    });
    return {
      records: response.records.map(historyRecordToPlain),
      people: [],
      cursor: response.nextCursor,
    };
  },
);
interface HistoryState {
  scope: string;
  revision: number;
  requestId: string | null;
  loading: boolean;
  error: boolean;
  records: CallHistoryRecord[];
  people: CallHistoryPerson[];
  cursor: string;
}
const initialState: HistoryState = {
  scope: "",
  revision: 0,
  requestId: null,
  loading: false,
  error: false,
  records: [],
  people: [],
  cursor: "",
};
const slice = createSlice({
  name: "callHistory",
  initialState,
  reducers: {},
  extraReducers: (builder) => {
    builder.addCase(removeChannel, (state, action) => {
      // A pending personal-history response can contain this channel even with no loaded rows.
      state.requestId = null;
      state.loading = false;
      state.revision += 1;
      if (state.records.some((record) => record.channelId === action.payload)) {
        state.records = state.records.filter((record) => record.channelId !== action.payload);
        state.people = [];
      }
    });
    builder.addCase(fetchCallHistory.pending, (state, action) => {
      const { organizationId, channelId, callId, cursor } = action.meta.arg;
      state.scope = historyScopeKey({ organizationId, channelId, callId });
      state.requestId = action.meta.requestId;
      state.loading = true;
      state.error = false;
      if (!cursor) {
        state.records = [];
        state.people = [];
        state.cursor = "";
      }
    });
    builder.addCase(fetchCallHistory.fulfilled, (state, action) => {
      if (state.requestId !== action.meta.requestId) return;
      state.loading = false;
      state.records =
        action.meta.arg.cursor && !action.meta.arg.callId
          ? [...state.records, ...action.payload.records]
          : action.payload.records;
      state.people = action.meta.arg.cursor
        ? [...state.people, ...action.payload.people]
        : action.payload.people;
      state.cursor = action.payload.cursor;
    });
    builder.addCase(fetchCallHistory.rejected, (state, action) => {
      if (state.requestId !== action.meta.requestId) return;
      state.loading = false;
      state.error = true;
      state.records = [];
      state.people = [];
      state.cursor = "";
    });
  },
});
export const callHistoryReducer = slice.reducer;
