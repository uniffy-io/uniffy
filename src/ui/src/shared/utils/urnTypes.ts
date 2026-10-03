// Kept separate from urn.ts to avoid circular imports through contentTypes config.
export const UrnType = {
  NOTE: "note",
  FILE: "file",
  FOLDER: "folder",
  CHAT: "chat",
  AGENT_CHAT: "agent_chat",
  AGENT_FOLDER: "agent_folder",
  CHAT_MESSAGE: "chat_message",
  USER: "user",
  TEAM: "team",
  CALENDAR: "calendar",
  CALENDAR_EVENT: "calendar_event",
  PROJECT: "project",
  TASK: "task",
  AGENT: "agent",
  AGENT_CRON_TASK: "agent_cron_task",
  ROOM: "room",
  TAG: "tag",
  UNKNOWN: "unknown",
} as const;

export type UrnType = (typeof UrnType)[keyof typeof UrnType];
