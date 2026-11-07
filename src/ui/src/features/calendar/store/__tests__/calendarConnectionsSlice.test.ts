import { afterEach, describe, expect, it, vi } from "vitest";
import { create } from "@bufbuild/protobuf";
import { CalendarProvider } from "@uniffy/proto/cal/v1/calendar_pb";
import {
  CalendarConnectionSchema,
  CalendarConnectionStatus,
  ProviderAvailabilitySchema,
  ProviderCredentialSource,
} from "@uniffy/proto/cal/v1/connections_pb";
import type { RootState } from "@/app/store";
import { connectionsApi } from "@/features/calendar/api/connectionsApi";
import {
  calendarConnectionsReducer,
  closeConnectionsDialog,
  openConnectionsDialog,
} from "@/features/calendar/store/calendarConnectionsSlice";
import {
  disconnectCalendarConnection,
  fetchCalendarConnections,
  pauseCalendarConnection,
  startCalendarConnection,
} from "@/features/calendar/store/calendarConnectionsThunks";

vi.mock("@/features/calendar/api/connectionsApi", () => ({
  connectionsApi: {
    listCalendarConnections: vi.fn(),
    startCalendarConnection: vi.fn(),
    pauseCalendarConnection: vi.fn(),
  },
}));
vi.mock("@/features/calendar/api/calendarApi", () => ({ calendarApi: {} }));
vi.mock("@/features/calendar/store/calendarThunks", () => ({
  getOrganizationId: () => "org",
  refreshVisibleRange: vi.fn(),
  timestampToIso: () => "",
}));
vi.mock("@/features/calendar/store/calendarsThunks", () => ({
  fetchCalendars: () => ({ type: "calendar/fetchCalendars" }),
}));

const state = () => ({ auth: { user: { id: "user" } } }) as RootState;
afterEach(() => vi.clearAllMocks());

const account = (status = CalendarConnectionStatus.ACTIVE) =>
  create(CalendarConnectionSchema, {
    id: "conn",
    provider: CalendarProvider.GOOGLE,
    accountEmail: "ann@example.com",
    status,
  });

describe("calendar connections thunks", () => {
  it("lists accounts and the providers members may connect", async () => {
    vi.mocked(connectionsApi.listCalendarConnections).mockResolvedValueOnce({
      connections: [account()],
      providers: [
        create(ProviderAvailabilitySchema, {
          provider: CalendarProvider.MICROSOFT,
          configured: true,
          credentialSource: ProviderCredentialSource.DEPLOYMENT,
        }),
      ],
      canConnect: true,
    } as never);
    const outcome = await fetchCalendarConnections()(vi.fn(), state, undefined);
    expect(fetchCalendarConnections.fulfilled.match(outcome)).toBe(true);
    const next = calendarConnectionsReducer(undefined, outcome);
    expect(next.loaded).toBe(true);
    expect(next.canConnect).toBe(true);
    expect(next.connections.map((entry) => entry.accountEmail)).toEqual(["ann@example.com"]);
    expect(next.providers).toEqual([
      {
        provider: "microsoft",
        configured: true,
        credentialSource: "deployment",
        writesEnabled: false,
      },
    ]);
  });

  it("asks for the sign-in address with the page to come back to", async () => {
    vi.mocked(connectionsApi.startCalendarConnection).mockResolvedValueOnce({
      authorizeUrl: "https://accounts.google.com/o/oauth2/auth?x=1",
    } as never);
    const outcome = await startCalendarConnection({
      provider: "google",
      returnPath: "/calendar",
      reconnectConnectionId: "conn",
    })(vi.fn(), state, undefined);
    expect(outcome.payload).toBe("https://accounts.google.com/o/oauth2/auth?x=1");
    expect(connectionsApi.startCalendarConnection).toHaveBeenCalledWith({
      organizationId: "org",
      provider: CalendarProvider.GOOGLE,
      returnPath: "/calendar",
      reconnectConnectionId: "conn",
    });
  });

  it("stores the account a pause returns and refreshes the calendar list", async () => {
    vi.mocked(connectionsApi.pauseCalendarConnection).mockResolvedValueOnce({
      connection: account(CalendarConnectionStatus.PAUSED),
    } as never);
    const dispatch = vi.fn();
    const outcome = await pauseCalendarConnection("conn")(dispatch, state, undefined);
    expect(dispatch).toHaveBeenCalledWith({ type: "calendar/fetchCalendars" });
    const listed = calendarConnectionsReducer(undefined, {
      type: fetchCalendarConnections.fulfilled.type,
      payload: {
        connections: [{ id: "conn", status: "active", calendars: [] }],
        providers: [],
        canConnect: true,
      },
    });
    const next = calendarConnectionsReducer(listed, outcome);
    expect(next.connections).toHaveLength(1);
    expect(next.connections[0].status).toBe("paused");
  });

  it("records a failed load and clears it when the next load starts", () => {
    const failed = calendarConnectionsReducer(undefined, {
      type: fetchCalendarConnections.rejected.type,
      payload: "unavailable",
    });
    expect(failed.loading).toBe(false);
    expect(failed.loaded).toBe(false);
    expect(failed.error).toBe("unavailable");
    const retrying = calendarConnectionsReducer(failed, {
      type: fetchCalendarConnections.pending.type,
    });
    expect(retrying.loading).toBe(true);
    expect(retrying.error).toBeNull();
    const listed = calendarConnectionsReducer(failed, {
      type: fetchCalendarConnections.fulfilled.type,
      payload: { connections: [], providers: [], canConnect: false },
    });
    expect(listed.error).toBeNull();
  });

  it("drops a disconnected account", () => {
    const listed = calendarConnectionsReducer(undefined, {
      type: fetchCalendarConnections.fulfilled.type,
      payload: { connections: [{ id: "conn" }], providers: [], canConnect: true },
    });
    const next = calendarConnectionsReducer(listed, {
      type: disconnectCalendarConnection.fulfilled.type,
      payload: "conn",
    });
    expect(next.connections).toEqual([]);
  });

  it("opens the dialog on one account and closes it", () => {
    const opened = calendarConnectionsReducer(undefined, openConnectionsDialog("conn"));
    expect(opened.dialog).toEqual({ focusConnectionId: "conn" });
    expect(calendarConnectionsReducer(opened, closeConnectionsDialog()).dialog).toBeNull();
    expect(calendarConnectionsReducer(undefined, openConnectionsDialog()).dialog).toEqual({
      focusConnectionId: null,
    });
  });
});
