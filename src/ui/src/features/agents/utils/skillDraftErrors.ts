import { SKILL_NAME_CONFLICT_FIELD } from "@/config/errorMessages";

// The rejection reaches the component as the thunk's string payload, so the
// validation field the backend raises with is the only marker available and the
// existing skill's name has to come out of the message. Both couplings live
// here so the review surface never string-matches an error itself.
const EXISTING_SKILL_NAME = /A skill named '([^']+)'/;

export interface SkillNameConflict {
  existingSkillName: string;
}

/** Null when the rejection is something other than the name-collision refusal. */
export function parseSkillNameConflict(error: unknown): SkillNameConflict | null {
  const message = typeof error === "string" ? error : error instanceof Error ? error.message : "";
  if (!message.includes(SKILL_NAME_CONFLICT_FIELD)) return null;
  return { existingSkillName: EXISTING_SKILL_NAME.exec(message)?.[1] ?? "" };
}
