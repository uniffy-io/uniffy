import { Lightning, Phone } from "@phosphor-icons/react";
import type { SerializedRunnableSkill } from "@/features/agents/store/agentRunnableSkillsThunks";

export const COMPOSER_COMMANDS = {
  call: {
    name: "call",
    label: "Open call setup",
    description: "Choose your mic and camera, then join.",
    icon: Phone,
  },
} as const;

export type ComposerCommandId = keyof typeof COMPOSER_COMMANDS;
export type ComposerCommandHandlers = Partial<Record<ComposerCommandId, () => boolean>>;

export function composerActions(handlers: ComposerCommandHandlers) {
  return (Object.keys(COMPOSER_COMMANDS) as ComposerCommandId[])
    .filter((id) => !!handlers[id])
    .map((id) => ({ ...COMPOSER_COMMANDS[id], id, kind: "action" as const }));
}

export type ComposerOption =
  | ReturnType<typeof composerActions>[number]
  | {
      id: string;
      name: string;
      label: string;
      description: string;
      icon: typeof Lightning;
      kind: "skill";
      skill: SerializedRunnableSkill;
    };

export function composerOptions(
  actions: ReturnType<typeof composerActions>,
  skills: SerializedRunnableSkill[],
  query: string,
): ComposerOption[] {
  const reserved = new Set<string>(actions.map((action) => action.name));
  const options: ComposerOption[] = [
    ...actions,
    ...skills
      .filter((skill) => !reserved.has(skill.name.toLowerCase()))
      .map((skill) => ({
        id: skill.id,
        name: skill.name,
        label: skill.displayName,
        description: skill.description,
        icon: Lightning,
        kind: "skill" as const,
        skill,
      })),
  ];
  const normalized = query.trim().toLowerCase();
  return options.filter((option) =>
    [option.name, option.label, option.description].some((text) =>
      text.toLowerCase().includes(normalized),
    ),
  );
}

export function matchComposerAction(content: string, actions: ReturnType<typeof composerActions>) {
  return actions.find((action) => content.trim().toLowerCase() === `/${action.name}`);
}

export function isStandaloneCommand(content: string, query: string): boolean {
  return content.trim() === `/${query}`;
}
