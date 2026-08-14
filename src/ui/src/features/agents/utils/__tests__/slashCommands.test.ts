import { describe, expect, it } from "vitest";
import { computeSlashToken, matchLeadingSkillCommand } from "@/features/agents/utils/slashCommands";

const skill = (id: string, name: string) => ({ id, name });

describe("computeSlashToken", () => {
  it("opens at start of input", () => {
    expect(computeSlashToken("/rep")).toEqual({ start: 0, query: "rep" });
  });

  it("opens after whitespace", () => {
    expect(computeSlashToken("hello /run")).toEqual({ start: 6, query: "run" });
  });

  it("does not open mid-word (path or URL)", () => {
    expect(computeSlashToken("https://foo")).toBeNull();
    expect(computeSlashToken("a/b")).toBeNull();
  });

  it("closes once the token has whitespace", () => {
    expect(computeSlashToken("/run now")).toBeNull();
  });

  it("returns null without a slash", () => {
    expect(computeSlashToken("just text")).toBeNull();
  });

  it("tracks an empty query right after the slash", () => {
    expect(computeSlashToken("/")).toEqual({ start: 0, query: "" });
  });
});

describe("matchLeadingSkillCommand", () => {
  const skills = [skill("s1", "pr-review"), skill("s2", "summarize")];

  it("splits the command off the rest of the message", () => {
    expect(
      matchLeadingSkillCommand("/pr-review https://github.com/uniffy-io/uniffy/pull/1", skills),
    ).toEqual({ skill: skills[0], rest: "https://github.com/uniffy-io/uniffy/pull/1" });
  });

  it("matches a bare command with no arguments", () => {
    expect(matchLeadingSkillCommand("/summarize", skills)).toEqual({
      skill: skills[1],
      rest: "",
    });
  });

  it("matches case-insensitively", () => {
    expect(matchLeadingSkillCommand("/PR-Review now", skills)?.skill).toBe(skills[0]);
  });

  it("keeps a multi-line remainder intact", () => {
    expect(matchLeadingSkillCommand("/summarize line one\nline two", skills)?.rest).toBe(
      "line one\nline two",
    );
  });

  it("ignores an unknown command", () => {
    expect(matchLeadingSkillCommand("/etc/hosts is a file", skills)).toBeNull();
    expect(matchLeadingSkillCommand("/deploy now", skills)).toBeNull();
  });

  it("ignores a command that is not leading", () => {
    expect(matchLeadingSkillCommand("run /pr-review please", skills)).toBeNull();
  });

  it("returns null for plain text", () => {
    expect(matchLeadingSkillCommand("pr-review this please", skills)).toBeNull();
  });
});
