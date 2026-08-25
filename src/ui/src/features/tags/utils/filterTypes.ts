import { UrnType } from "@/shared/utils/urnTypes";

/** The content types tags can carry, offered by the tag filter rail. */
export const TAG_FILTER_TYPES: UrnType[] = [
  UrnType.NOTE,
  UrnType.FILE,
  UrnType.CALENDAR_EVENT,
  UrnType.CHAT,
  UrnType.AGENT,
  UrnType.PROJECT,
  UrnType.TASK,
];
