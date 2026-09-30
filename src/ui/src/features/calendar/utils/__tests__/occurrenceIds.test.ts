import { describe, it, expect } from "vitest";
import { masterEventId } from "@/features/calendar/utils/occurrenceIds";

const MASTER = "0d1d3c4a-6f2e-4b8a-9c3d-2f1e5a7b9c0d";

describe("masterEventId", () => {
  it("strips the occurrence suffix from an expanded instance id", () => {
    expect(masterEventId(`${MASTER}__occurrence__2026-09-28`)).toBe(MASTER);
  });

  it("returns a plain event id unchanged", () => {
    expect(masterEventId(MASTER)).toBe(MASTER);
  });
});
