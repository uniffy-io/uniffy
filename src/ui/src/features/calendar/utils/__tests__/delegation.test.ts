import { describe, expect, it } from "vitest";
import type { Attendee, CalendarDelegationInfo } from "@/features/calendar/types";
import { attendeesAnswerableFor, delegationLevelLabel } from "@/features/calendar/utils/delegation";

const attendee = (id: string, role: Attendee["role"] = "required"): Attendee => ({
  id,
  name: id,
  email: `${id}@example.com`,
  initials: id.slice(0, 2).toUpperCase(),
  status: "pending",
  role,
});

const grant = (grantorId: string, inactive = false): CalendarDelegationInfo => ({
  id: `d-${grantorId}`,
  grantorId,
  grantorName: grantorId,
  delegateId: "me",
  delegateName: "Me",
  level: "events",
  createdAt: "",
  inactive,
});

describe("attendeesAnswerableFor", () => {
  it("offers only invited grantors with a live delegation", () => {
    const attendees = [attendee("bob"), attendee("carol"), attendee("dave")];
    const answerable = attendeesAnswerableFor(attendees, [grant("bob"), grant("dave", true)]);
    expect(answerable.map((a) => a.id)).toEqual(["bob"]);
  });

  it("never offers to answer for the organizer", () => {
    expect(attendeesAnswerableFor([attendee("bob", "organizer")], [grant("bob")])).toEqual([]);
  });
});

describe("delegationLevelLabel", () => {
  it("names both levels", () => {
    expect(delegationLevelLabel("events")).toBe("Events");
    expect(delegationLevelLabel("events_and_private")).toBe("Events and private details");
  });
});
