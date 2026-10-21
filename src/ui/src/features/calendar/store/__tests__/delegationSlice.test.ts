import { describe, expect, it } from "vitest";
import { create } from "@bufbuild/protobuf";
import {
  CalendarDelegationLevel,
  CalendarDelegationSchema,
  CalendarListSection,
  CalendarSchema,
  CalendarType,
} from "@uniffy/proto/cal/v1/calendar_pb";
import { AccessMode, ContentRole } from "@uniffy/proto/common/v1/common_pb";
import { calendarReducer } from "@/features/calendar/store/calendarSlice";
import { calendarFromProto } from "@/features/calendar/store/calendarsThunks";
import {
  delegationFromProto,
  fetchMyDelegations,
  grantDelegation,
  revokeDelegation,
} from "@/features/calendar/store/delegationThunks";

const delegation = delegationFromProto(
  create(CalendarDelegationSchema, {
    id: "d1",
    grantorId: "bob",
    grantorName: "Bob",
    delegateId: "alice",
    delegateName: "Alice",
    level: CalendarDelegationLevel.EVENTS,
  }),
);

describe("delegation wire mapping", () => {
  it("maps the level and keeps both names", () => {
    expect(delegation).toMatchObject({
      grantorName: "Bob",
      delegateName: "Alice",
      level: "events",
      inactive: false,
    });
  });

  it("reads a delegated calendar's section and level", () => {
    const calendar = calendarFromProto(
      create(CalendarSchema, {
        id: "bobs",
        ownerId: "bob",
        ownerName: "Bob",
        name: "My Calendar",
        isDefault: true,
        calendarType: CalendarType.PERSONAL,
        accessMode: AccessMode.OWNER_ONLY,
        userRole: ContentRole.EDITOR,
        section: CalendarListSection.DELEGATED,
        delegationLevel: CalendarDelegationLevel.EVENTS_AND_PRIVATE,
      }),
    );
    expect(calendar.section).toBe("delegated");
    expect(calendar.delegationLevel).toBe("events_and_private");
  });
});

describe("delegation state", () => {
  const loaded = calendarReducer(
    undefined,
    fetchMyDelegations.fulfilled({ grantedByMe: [delegation], grantedToMe: [] }, "req", undefined),
  );

  it("replaces a grant whose level changed instead of duplicating it", () => {
    const raised = { ...delegation, level: "events_and_private" as const };
    const state = calendarReducer(
      loaded,
      grantDelegation.fulfilled(raised, "req", {
        delegateId: "alice",
        level: "events_and_private",
      }),
    );
    expect(state.delegationsByMe).toEqual([raised]);
  });

  it("drops a revoked grant from both lists", () => {
    const both = calendarReducer(
      undefined,
      fetchMyDelegations.fulfilled(
        { grantedByMe: [delegation], grantedToMe: [{ ...delegation, id: "d2" }] },
        "req",
        undefined,
      ),
    );
    let state = calendarReducer(both, revokeDelegation.fulfilled("d1", "req", "d1"));
    state = calendarReducer(state, revokeDelegation.fulfilled("d2", "req", "d2"));
    expect(state.delegationsByMe).toEqual([]);
    expect(state.delegationsToMe).toEqual([]);
  });
});
