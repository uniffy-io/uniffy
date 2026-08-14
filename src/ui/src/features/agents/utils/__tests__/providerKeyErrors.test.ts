import { describe, expect, it } from "vitest";
import { summarizeKeyError } from "@/features/agents/utils/providerKeyErrors";

const ANTHROPIC_401 =
  "Authentication failed: Error code: 401 - {'type': 'error', 'error': {'type': 'authentication_error', 'message': 'invalid x-api-key'}, 'request_id': 'req_011'}";

describe("summarizeKeyError", () => {
  it("leads with an actionable sentence and keeps the raw response as detail", () => {
    const { headline, detail } = summarizeKeyError(ANTHROPIC_401, "Anthropic");
    expect(headline).toContain("Anthropic did not accept this credential");
    expect(headline).not.toContain("request_id");
    expect(detail).toBe(ANTHROPIC_401);
  });

  it.each([
    ["Error code: 402 - insufficient billing", "no available credit"],
    ["Error code: 429 - rate limit exceeded", "rate-limited"],
    ["Error code: 503 - upstream unavailable", "could not be reached"],
    ["connect timeout after 10s", "could not be reached"],
  ])("summarizes %s", (raw, expected) => {
    expect(summarizeKeyError(raw, "OpenAI").headline).toContain(expected);
  });

  it("falls back to a plain rejection when the text says nothing useful", () => {
    expect(summarizeKeyError("nope", "xAI").headline).toBe("xAI rejected this key.");
  });

  it("has no detail to reveal when the provider sent no text", () => {
    expect(summarizeKeyError(undefined, "Google Gemini")).toEqual({
      headline: "Google Gemini rejected this key.",
      detail: null,
    });
  });
});
