import { describe, expect, it, vi } from "vitest";
import { create } from "@bufbuild/protobuf";
import {
  CalendarEventSchema,
  CalendarListSection,
  CalendarProvider,
  CalendarSchema,
  CalendarSubscriptionSchema,
  CalendarSubscriptionState,
  CalendarSyncDirection,
  ConnectedCalendarState,
  ConnectedCalendarSummarySchema,
} from "@uniffy/proto/cal/v1/calendar_pb";
import { calendarToPlain, eventToPlain } from "@features/calendar/calendarSerializer";

vi.mock("@core/datetimePrefs", () => ({ getEffectiveTimeZone: () => "UTC" }));

function connected(state: ConnectedCalendarState, countsAsBusy = false) {
  return create(CalendarSchema, {
    id: "cal-1",
    name: "Work",
    section: CalendarListSection.CONNECTED,
    connection: create(ConnectedCalendarSummarySchema, {
      provider: CalendarProvider.MICROSOFT,
      accountEmail: "ada@corp.example",
      direction: CalendarSyncDirection.TWO_WAY,
      state,
      countsAsBusy,
    }),
  });
}

describe("connected calendar serialization", () => {
  it("files the calendar under its own section with the provider account", () => {
    const plain = calendarToPlain(connected(ConnectedCalendarState.HEALTHY, true));

    expect(plain.section).toBe("connected");
    expect(plain.connection).toEqual({ provider: "microsoft", accountEmail: "ada@corp.example" });
    expect(plain.countsAsBusy).toBe(true);
    expect(plain.feedBroken).toBe(false);
    expect(plain.needsReconnect).toBe(false);
  });

  it("marks a calendar whose syncs keep failing or whose account must reconnect", () => {
    expect(calendarToPlain(connected(ConnectedCalendarState.BROKEN)).feedBroken).toBe(true);
    const reauth = calendarToPlain(connected(ConnectedCalendarState.REAUTH_REQUIRED));
    expect(reauth.needsReconnect).toBe(true);
    expect(reauth.feedBroken).toBe(false);
  });

  it("leaves the account out when the caller is not its owner", () => {
    const shared = create(CalendarSchema, { id: "c", section: CalendarListSection.CONNECTED });
    expect(calendarToPlain(shared).connection).toBeUndefined();
  });

  it("keeps reading a subscribed feed's state", () => {
    const feed = create(CalendarSchema, {
      id: "feed",
      section: CalendarListSection.SUBSCRIBED,
      isReadOnly: true,
      subscription: create(CalendarSubscriptionSchema, {
        state: CalendarSubscriptionState.BROKEN,
        countsAsBusy: true,
      }),
    });
    const plain = calendarToPlain(feed);
    expect(plain.section).toBe("subscribed");
    expect(plain.feedBroken).toBe(true);
    expect(plain.countsAsBusy).toBe(true);
    expect(plain.connection).toBeUndefined();
  });
});

describe("provider edit hint", () => {
  it("names the provider a read-only synced event must be edited in", () => {
    const event = create(CalendarEventSchema, {
      id: "e",
      providerEditHint: CalendarProvider.GOOGLE,
    });
    expect(eventToPlain(event).providerEditHint).toBe("google");
  });

  it("is absent when Uniffy can change the event", () => {
    expect(eventToPlain(create(CalendarEventSchema, { id: "e" })).providerEditHint).toBeUndefined();
  });
});
