import { UrnType } from '@/shared/utils/urn';
import { cn } from '@/shared/utils/cn';

export const EXPANDABLE_URN_TYPES = new Set<string>([
  UrnType.TASK,
  UrnType.CALENDAR_EVENT,
  UrnType.PROJECT,
  UrnType.FILE,
  UrnType.FOLDER,
  UrnType.NOTE,
  UrnType.CHAT,
  UrnType.CHAT_MESSAGE,
  UrnType.TAG,
  UrnType.ROOM,
]);

export function hasExpandedCard(type: string): boolean {
  return EXPANDABLE_URN_TYPES.has(type);
}

/** Subject kinds that render as Slack-style `@Name` text tokens instead of boxed chips. */
export const PEOPLE_TOKEN_TYPES = new Set<string>([
  UrnType.USER,
  UrnType.AGENT,
  UrnType.TEAM,
]);

export function isPeopleTokenType(type: string): boolean {
  return PEOPLE_TOKEN_TYPES.has(type);
}

/** Slack-style people mention: pure typography, one accent for every subject
 *  kind. Avatars, presence, and the agent badge live in the hover card only.
 *  Every surface that renders a people token composes from here. */
export function peopleTokenClasses(selfMention: boolean, selected: boolean): string {
  return cn(
    'mention-token inline align-baseline rounded px-1 box-decoration-clone',
    'font-medium cursor-pointer select-none transition-colors',
    selfMention
      ? 'bg-primary/25 text-primary hover:bg-primary/30'
      : 'bg-primary/10 text-primary hover:bg-primary/20',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
    selected && 'ring-2 ring-primary ring-offset-1 ring-offset-background',
  );
}
