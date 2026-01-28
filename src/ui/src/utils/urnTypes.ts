/**
 * URN Type Definitions
 *
 * Defines the supported URN types in the UNIFFY system.
 * This file is kept separate to avoid circular dependencies.
 */

export const UrnType = {
  NOTE: 'note',
  FILE: 'file',
  CHAT: 'chat',
  USER: 'user',
  CALENDAR_EVENT: 'calendar_event',
  UNKNOWN: 'unknown',
} as const;

export type UrnType = (typeof UrnType)[keyof typeof UrnType];
