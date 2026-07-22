// Kept separate from urn.ts to avoid circular imports through contentTypes config.
export const UrnType = {
  NOTE: 'note',
  FILE: 'file',
  FOLDER: 'folder',
  CHAT: 'chat',
  AGENT_CHAT: 'agent_chat',
  AGENT_FOLDER: 'agent_folder',
  CHAT_MESSAGE: 'chat_message',
  USER: 'user',
  CALENDAR_EVENT: 'calendar_event',
  PROJECT: 'project',
  TASK: 'task',
  AGENT: 'agent',
  PROMPT: 'prompt',
  ROOM: 'room',
  TAG: 'tag',
  UNKNOWN: 'unknown',
} as const;

export type UrnType = (typeof UrnType)[keyof typeof UrnType];
