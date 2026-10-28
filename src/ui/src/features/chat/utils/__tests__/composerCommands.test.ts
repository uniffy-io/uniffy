import { describe, expect, it, vi } from "vitest";
import {
  composerActions,
  composerOptions,
  isStandaloneCommand,
  matchComposerAction,
} from "@/features/chat/utils/composerCommands";

const review = {
  id: "review-skill",
  name: "review",
  displayName: "Review changes",
  description: "Check code for errors",
};
const actions = composerActions({ call: () => true });

describe("composer command discovery", () => {
  it("only offers actions supported by this composer, without executing them", () => {
    const call = vi.fn(() => true);
    expect(composerActions({})).toEqual([]);
    expect(composerActions({ call }).map((action) => action.name)).toEqual(["call"]);
    expect(call).not.toHaveBeenCalled();
  });

  it("lists chat actions alongside available agent skills", () => {
    expect(
      composerOptions(actions, [review], "").map((option) => [option.kind, option.name]),
    ).toEqual([
      ["action", "call"],
      ["skill", "review"],
    ]);
  });

  it("filters names, labels and descriptions without regard to case", () => {
    expect(composerOptions(actions, [review], "CAL").map((option) => option.name)).toEqual([
      "call",
    ]);
    expect(composerOptions(actions, [review], "setup").map((option) => option.name)).toEqual([
      "call",
    ]);
    expect(composerOptions(actions, [review], "errors").map((option) => option.name)).toEqual([
      "review",
    ]);
    expect(composerOptions(actions, [review], "missing")).toEqual([]);
  });

  it("reserves supported action names while leaving skills available in other contexts", () => {
    const conflicting = { ...review, name: "CALL" };
    expect(composerOptions(actions, [conflicting], "call").map((option) => option.kind)).toEqual([
      "action",
    ]);
    expect(composerOptions([], [conflicting], "call").map((option) => option.kind)).toEqual([
      "skill",
    ]);
  });

  it("only runs exact commands, preserving prose, paths and arguments", () => {
    expect(matchComposerAction(" /CALL \n", actions)?.id).toBe("call");
    for (const text of ["/callback", "/call later", "discuss /call", "/call/path", "/"]) {
      expect(matchComposerAction(text, actions)).toBeUndefined();
    }
  });

  it("offers immediate actions only when the slash query is the whole draft", () => {
    expect(isStandaloneCommand("/", "")).toBe(true);
    expect(isStandaloneCommand(" /ca", "ca")).toBe(true);
    expect(isStandaloneCommand("Discuss /ca", "ca")).toBe(false);
    expect(isStandaloneCommand("/ca\nKeep this text", "ca")).toBe(false);
  });
});
