import { describe, expect, it } from "vitest";
import {
  confirmationFor,
  GENERIC_REFUSAL,
  isUsableRespondLink,
  refusalFor,
  answerLabelFor,
  RESPOND_ANSWERS,
} from "@/features/calendar/utils/respondFeedback";

describe("isUsableRespondLink", () => {
  it("accepts the three answers an invitation offers", () => {
    for (const answer of ["accepted", "tentative", "declined"]) {
      expect(isUsableRespondLink("a-token", answer)).toBe(true);
    }
  });

  it("refuses a link with no token", () => {
    expect(isUsableRespondLink("", "accepted")).toBe(false);
  });

  it("refuses an answer the product does not offer", () => {
    expect(isUsableRespondLink("a-token", "maybe-later")).toBe(false);
  });

  it("is not fooled by a property every object has", () => {
    // The answer comes straight from the query string; a plain-object lookup
    // would resolve these up the prototype chain and hand back a function.
    expect(isUsableRespondLink("a-token", "constructor")).toBe(false);
    expect(isUsableRespondLink("a-token", "toString")).toBe(false);
    expect(isUsableRespondLink("a-token", "__proto__")).toBe(false);
  });
});

describe("confirmationFor", () => {
  it("confirms each answer in the recipient's terms", () => {
    expect(confirmationFor("accepted")).toContain("going");
    expect(confirmationFor("declined")).toContain("not going");
    expect(confirmationFor("tentative")).toContain("maybe");
  });

  it("says nothing about an answer it does not know", () => {
    expect(confirmationFor("elsewhere")).toBeNull();
    expect(confirmationFor("constructor")).toBeNull();
  });
});

describe("refusalFor", () => {
  it.each([
    [401, "expired"],
    [403, "no longer invited"],
    [404, "no longer available"],
    [409, "no longer be answered"],
    [429, "Too many attempts"],
  ])("explains a %i in terms the recipient can act on", (status, expected) => {
    expect(refusalFor(status)).toContain(expected);
  });

  it("falls back rather than showing a bare status", () => {
    expect(refusalFor(500)).toBe(GENERIC_REFUSAL);
    expect(refusalFor(418)).toBe(GENERIC_REFUSAL);
  });

  it("never leaks who else is involved or whether the event exists", () => {
    const every = [401, 403, 404, 409, 429, 500].map(refusalFor);
    for (const message of every) {
      expect(message).not.toMatch(/@|organizer'?s|attendee/i);
    }
  });
});

describe("answerLabelFor", () => {
  it("labels every answer the mail links can carry", () => {
    expect([...RESPOND_ANSWERS].sort()).toEqual(["accepted", "declined", "tentative"]);
    expect(RESPOND_ANSWERS.map(answerLabelFor)).toEqual(["Yes", "Maybe", "No"]);
  });

  it("returns nothing for an inherited property name", () => {
    expect(answerLabelFor("toString")).toBeNull();
  });
});
