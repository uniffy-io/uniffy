import { describe, expect, it } from "vitest";
import { calendarLabel } from "@/features/calendar/utils/calendarLabel";

const colleaguesDefault = {
  name: "My Calendar",
  isDefault: true,
  ownerId: "diana",
  ownerName: "Diana Prince",
};

describe("calendar labels", () => {
  it("names a colleague's default calendar after its owner", () => {
    expect(calendarLabel(colleaguesDefault, "alice")).toBe("Diana Prince");
  });

  it("keeps the stored name for the owner", () => {
    expect(calendarLabel(colleaguesDefault, "diana")).toBe("My Calendar");
  });

  it("keeps the stored name for any other calendar", () => {
    expect(calendarLabel({ ...colleaguesDefault, isDefault: false, name: "Design" }, "alice")).toBe(
      "Design",
    );
  });

  it("falls back to the stored name when the owner's name is unknown", () => {
    expect(calendarLabel({ ...colleaguesDefault, ownerName: "" }, "alice")).toBe("My Calendar");
  });
});
