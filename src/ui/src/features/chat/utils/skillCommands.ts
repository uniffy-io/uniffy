import { matchLeadingSkillCommand } from "@/features/agents/utils/slashCommands";
import { extractMentionsFromMarkdown } from "@/shared/utils/mentionUtils";
import { parseUrn, UrnType } from "@/shared/utils/urn";

export function mentionedSkillAgents(content: string): string[] {
  return extractMentionsFromMarkdown(content)
    .map((mention) => parseUrn(mention.urn))
    .filter((urn) => urn.type === UrnType.AGENT && urn.id)
    .map((urn) => urn.id!);
}

export function resolveChatSkillAgent(
  mentionedAgentIds: readonly string[],
  ...contextAgentIds: (string | null | undefined)[]
): string | undefined {
  const targets = new Set([...mentionedAgentIds, ...contextAgentIds].filter(Boolean));
  return targets.size === 1 ? [...targets][0]! : undefined;
}

export function matchChatSkillCommand<T extends { name: string }>(
  content: string,
  skills: readonly T[],
): { skill: T; rest: string } | null {
  const prefix =
    /^(?:\[\[\[[^[\]|]+\|urn:uniffy:content:AGENT:[^\]]+\]\]\]\s*)+/.exec(content)?.[0] ?? "";
  const command = matchLeadingSkillCommand(content.slice(prefix.length), skills);
  if (!command) return null;
  return { skill: command.skill, rest: `${prefix}${command.rest}`.trim() };
}
