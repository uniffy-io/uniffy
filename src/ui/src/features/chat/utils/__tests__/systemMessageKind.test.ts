import { describe, expect, it } from "vitest";
import { classifySystemMessage } from "@/features/chat/utils/systemMessageKind";

describe("classifySystemMessage", () => {
  it("classifies by stamped metadata regardless of wording", () => {
    expect(classifySystemMessage("Anruf gestartet", { kind: "call_started" })).toBe("call-start");
    expect(classifySystemMessage("Anruf beendet", { kind: "call_ended" })).toBe("call-end");
    expect(classifySystemMessage("ist beigetreten", { kind: "member_joined" })).toBe("join");
  });

  it("prefers metadata over conflicting wording", () => {
    expect(classifySystemMessage("Alice started a call", { kind: "call_ended" })).toBe("call-end");
  });

  it("falls back to wording for messages that predate the metadata", () => {
    expect(classifySystemMessage("Alice started a call")).toBe("call-start");
    expect(classifySystemMessage("Alice ended the call for everyone - 5m 00s")).toBe("call-end");
    expect(classifySystemMessage("Call ended - 42s")).toBe("call-end");
    expect(classifySystemMessage("Alice joined the channel")).toBe("join");
    expect(classifySystemMessage("Alice renamed the channel")).toBe("generic");
  });

  it("ignores unknown or non-string metadata kinds", () => {
    expect(classifySystemMessage("Alice started a call", { kind: "tool_call" })).toBe("call-start");
    expect(classifySystemMessage("something happened", { kind: 7 })).toBe("generic");
  });
});
