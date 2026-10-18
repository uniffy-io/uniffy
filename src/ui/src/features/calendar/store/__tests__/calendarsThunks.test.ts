import { afterEach, describe, expect, it, vi } from "vitest";
import { create } from "@bufbuild/protobuf";
import { CalendarSchema } from "@uniffy/proto/cal/v1/calendar_pb";
import { calendarApi } from "@/features/calendar/api/calendarApi";
import { fetchCalendars, setCalendarVisibility } from "@/features/calendar/store/calendarsThunks";
import type { RootState } from "@/app/store";

vi.mock("@/features/calendar/api/calendarApi", () => ({
  calendarApi: {
    listCalendars: vi.fn(),
    setCalendarVisibility: vi.fn(),
  },
}));
vi.mock("@/features/calendar/store/calendarThunks", () => ({
  getOrganizationId: () => "org",
  refreshVisibleRange: vi.fn(),
  timestampToIso: () => "",
}));
const state = () => ({ auth: { user: { id: "user" } } }) as RootState;
afterEach(() => vi.clearAllMocks());

describe("calendar requests", () => {
  it("saves rapid visibility changes in click order", async () => {
    const calendar = create(CalendarSchema, { id: "calendar" });
    let finishFirst!: (value: { calendar: typeof calendar }) => void;
    const firstResponse = new Promise<{ calendar: typeof calendar }>((resolve) => {
      finishFirst = resolve;
    });
    vi.mocked(calendarApi.setCalendarVisibility)
      .mockReturnValueOnce(firstResponse as never)
      .mockResolvedValueOnce({ calendar: { ...calendar, isHidden: false } } as never);
    const hide = setCalendarVisibility({ calendarId: "calendar", hidden: true })(
      vi.fn(),
      state,
      undefined,
    );
    await vi.waitFor(() => expect(calendarApi.setCalendarVisibility).toHaveBeenCalledTimes(1));
    const show = setCalendarVisibility({ calendarId: "calendar", hidden: false })(
      vi.fn(),
      state,
      undefined,
    );
    await Promise.resolve();
    expect(calendarApi.setCalendarVisibility).toHaveBeenCalledTimes(1);
    finishFirst({ calendar: { ...calendar, isHidden: true } });
    await Promise.all([hide, show]);
    expect(
      vi.mocked(calendarApi.setCalendarVisibility).mock.calls.map(([request]) => request.hidden),
    ).toEqual([true, false]);
  });

  it("loads calendars beyond the first page", async () => {
    vi.mocked(calendarApi.listCalendars)
      .mockResolvedValueOnce({
        calendars: [create(CalendarSchema, { id: "first" })],
        nextPageToken: "next",
      } as never)
      .mockResolvedValueOnce({
        calendars: [create(CalendarSchema, { id: "last" })],
        nextPageToken: "",
      } as never);
    const result = await fetchCalendars()(vi.fn(), state, undefined);
    expect(fetchCalendars.fulfilled.match(result)).toBe(true);
    expect((result.payload as { id: string }[]).map((calendar) => calendar.id)).toEqual([
      "first",
      "last",
    ]);
    expect(calendarApi.listCalendars).toHaveBeenLastCalledWith({
      organizationId: "org",
      pageToken: "next",
    });
  });
});
