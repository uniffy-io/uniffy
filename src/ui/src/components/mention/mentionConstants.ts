import { UrnType } from '@/shared/utils/urn';

export const EXPANDABLE_URN_TYPES = new Set<string>([
  UrnType.TASK,
  UrnType.CALENDAR_EVENT,
  UrnType.PROJECT,
  UrnType.FILE,
  UrnType.NOTE,
  UrnType.CHAT,
]);

export function hasExpandedCard(type: string): boolean {
  return EXPANDABLE_URN_TYPES.has(type);
}
