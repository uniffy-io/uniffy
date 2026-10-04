import { describe, expect, it } from "vitest";
import { create } from "@bufbuild/protobuf";
import {
  CalendarDelegationLevel,
  CalendarDelegationSchema,
  CalendarListSection,
  CalendarSchema,
} from "@uniffy/proto/cal/v1/calendar_pb";
import { ContentRole } from "@uniffy/proto/common/v1/common_pb";
import {
  answerableAttendees,
  calendarHint,
  writableCalendars,
} from "@features/calendar/calendarList";
import {
  calendarToPlain,
  delegationToPlain,
  type SerializedAttendee,
  type SerializedDelegation,
} from "@features/calendar/calendarSerializer";

const attendee = (
  id: string,
  role: SerializedAttendee["role"] = "required",
): SerializedAttendee => ({
  id,
  name: id,
  email: `${id}@example.com`,
  initials: id.slice(0, 2),
  status: "pending",
  role,
});

const grant = (grantorId: string, inactive = false): SerializedDelegation => ({
  id: `d-${grantorId}`,
  grantorId,
  grantorName: grantorId,
  delegateId: "me",
  delegateName: "Me",
  level: "events",
  inactive,
});

describe("delegated calendars", () => {
  const bobs = calendarToPlain(
    create(CalendarSchema, {
      id: "bobs",
      ownerId: "bob",
      ownerName: "Bob",
      name: "My Calendar",
      isDefault: true,
      userRole: ContentRole.EDITOR,
      section: CalendarListSection.DELEGATED,
      delegationLevel: CalendarDelegationLevel.EVENTS,
    }),
  );

  it("reads the section and level off the wire", () => {
    expect(bobs.section).toBe("delegated");
    expect(bobs.delegationLevel).toBe("events");
  });

  it("is offered as a target and says why", () => {
    expect(writableCalendars([bobs]).map((c) => c.id)).toEqual(["bobs"]);
    expect(calendarHint(bobs)).toBe("As their delegate");
  });

  it("maps a delegation", () => {
    const plain = delegationToPlain(
      create(CalendarDelegationSchema, {
        id: "d1",
        grantorId: "bob",
        grantorName: "Bob",
        delegateId: "me",
        delegateName: "Me",
        level: CalendarDelegationLevel.EVENTS_AND_PRIVATE,
        inactive: true,
      }),
    );
    expect(plain).toMatchObject({ level: "events_and_private", inactive: true });
  });
});

describe("answering for a grantor", () => {
  it("offers only invited grantors with a live delegation", () => {
    const answerable = answerableAttendees(
      [attendee("bob"), attendee("carol"), attendee("dave")],
      [grant("bob"), grant("dave", true)],
    );
    expect(answerable.map((a) => a.id)).toEqual(["bob"]);
  });

  it("never offers to answer for the organizer", () => {
    expect(answerableAttendees([attendee("bob", "organizer")], [grant("bob")])).toEqual([]);
  });
});
