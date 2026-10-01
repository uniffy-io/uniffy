import { describe, expect, it } from "vitest";
import { friendlyErrorMessage } from "@/config/errorMessages";

describe("friendlyErrorMessage", () => {
  it("shows the task export row cap as the server words it", () => {
    expect(
      friendlyErrorMessage(
        "[invalid_argument] Validation error on 'filter': This export would include 250,000 " +
          "tasks, over the 200,000 limit. Narrow the filter or export fewer projects.",
      ),
    ).toBe(
      "This export would include 250,000 tasks, over the 200,000 limit. " +
        "Narrow the filter or export fewer projects.",
    );
  });
});
