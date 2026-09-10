import { describe, expect, it } from "vitest";
import {
  matchChatSkillCommand,
  mentionedSkillAgents,
  resolveChatSkillAgent,
} from "@/features/chat/utils/skillCommands";

const agentId = "11111111-1111-4111-8111-111111111111";
const mention = `[[[Helper|urn:uniffy:content:AGENT:${agentId}]]]`;
const skills = [{ id: "skill", name: "review" }];

describe("chat skill targeting", () => {
  it("uses only explicit agent references, deduplicated across labels", () => {
    expect(
      mentionedSkillAgents(
        `${mention} [[[Renamed|urn:uniffy:content:AGENT:${agentId}]]] ` +
          "[[[Note|urn:uniffy:content:NOTE:note]]] @Helper",
      ),
    ).toEqual([agentId]);
  });

  it("resolves a DM, mention, reply, or thread to one agent", () => {
    expect(resolveChatSkillAgent([], agentId)).toBe(agentId);
    expect(resolveChatSkillAgent([agentId])).toBe(agentId);
    expect(resolveChatSkillAgent([], undefined, agentId)).toBe(agentId);
    expect(resolveChatSkillAgent([], undefined, undefined, agentId)).toBe(agentId);
    expect(resolveChatSkillAgent([agentId], agentId, agentId)).toBe(agentId);
  });

  it("does not guess when no agent or multiple agents would respond", () => {
    expect(resolveChatSkillAgent([])).toBeUndefined();
    expect(resolveChatSkillAgent([agentId, "another"])).toBeUndefined();
    expect(resolveChatSkillAgent([agentId], undefined, "another")).toBeUndefined();
  });
});

describe("chat skill commands", () => {
  it("preserves leading agent mentions and the multiline user remainder", () => {
    const body = "First line\n/review remains text\n{{input}}";
    expect(matchChatSkillCommand(`${mention} /review ${body}`, skills)).toEqual({
      skill: skills[0],
      rest: `${mention} ${body}`,
    });
  });

  it("accepts a command before a mention and in an agent reply", () => {
    expect(matchChatSkillCommand(`/review ${mention} inspect`, skills)?.rest).toBe(
      `${mention} inspect`,
    );
    expect(matchChatSkillCommand("/review inspect", skills)?.rest).toBe("inspect");
    expect(matchChatSkillCommand(`${mention} /review`, skills)?.rest).toBe(mention);
  });

  it("leaves ordinary prose, paths, and commands after other content untouched", () => {
    expect(matchChatSkillCommand(`${mention} please /review this`, skills)).toBeNull();
    expect(matchChatSkillCommand(`${mention} /etc/hosts`, skills)).toBeNull();
    expect(
      matchChatSkillCommand("[[[Note|urn:uniffy:content:NOTE:note]]] /review", skills),
    ).toBeNull();
  });
});
