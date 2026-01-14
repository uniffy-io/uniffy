/**
 * URN Utilities
 *
 * Utilities for parsing and working with URNs in the UWOS system.
 * URN format: urn:uwos:{type}:{id}
 *
 * Examples:
 * - urn:uwos:note:123e4567-e89b-12d3-a456-426614174000
 * - urn:uwos:file:456e7890-e89b-12d3-a456-426614174001
 * - urn:uwos:chat:789e0123-e89b-12d3-a456-426614174002
 */

export enum UrnType {
  NOTE = 'note',
  FILE = 'file',
  CHAT = 'chat',
  USER = 'user',
  BOOK = 'book',
  CALENDAR_EVENT = 'calendar_event',
  PASSWORD = 'password',
  SPACE = 'space',
  UNKNOWN = 'unknown',
}

export interface ParsedUrn {
  /** Full URN string */
  urn: string;
  /** The type of the resource (note, file, etc.) */
  type: UrnType;
  /** The resource ID */
  id: string;
  /** Whether the URN is valid */
  isValid: boolean;
}

/**
 * Parse a URN string into its components
 */
export function parseUrn(urn: string): ParsedUrn {
  // Basic validation
  if (!urn || typeof urn !== 'string') {
    return {
      urn: urn || '',
      type: UrnType.UNKNOWN,
      id: '',
      isValid: false,
    };
  }

  // URN format: urn:uwos:{type}:{id}
  const parts = urn.split(':');

  if (parts.length !== 4 || parts[0] !== 'urn' || parts[1] !== 'uwos') {
    return {
      urn,
      type: UrnType.UNKNOWN,
      id: '',
      isValid: false,
    };
  }

  const typeStr = parts[2];
  const id = parts[3];

  // Map type string to enum
  const type = Object.values(UrnType).includes(typeStr as UrnType)
    ? (typeStr as UrnType)
    : UrnType.UNKNOWN;

  return {
    urn,
    type,
    id,
    isValid: type !== UrnType.UNKNOWN && !!id,
  };
}

/**
 * Build a URN from type and id
 */
export function buildUrn(type: UrnType | string, id: string): string {
  return `urn:uwos:${type}:${id}`;
}

/**
 * Extract the URL path from a URN
 * Example: urn:uwos:note:123 -> /notes/123
 */
export function urnToPath(urn: string): string {
  const parsed = parseUrn(urn);

  if (!parsed.isValid) {
    return '#';
  }

  // Map types to plural routes
  const routeMap: Record<UrnType, string> = {
    [UrnType.NOTE]: 'notes',
    [UrnType.FILE]: 'files',
    [UrnType.CHAT]: 'chats',
    [UrnType.USER]: 'users',
    [UrnType.BOOK]: 'books',
    [UrnType.CALENDAR_EVENT]: 'calendar',
    [UrnType.PASSWORD]: 'passwords',
    [UrnType.SPACE]: 'spaces',
    [UrnType.UNKNOWN]: '',
  };

  const route = routeMap[parsed.type];
  return route ? `/${route}/${parsed.id}` : '#';
}

/**
 * Get display icon for URN type (returns Heroicon name)
 */
export function getUrnIcon(urn: string): string {
  const parsed = parseUrn(urn);

  const iconMap: Record<UrnType, string> = {
    [UrnType.NOTE]: 'DocumentTextIcon',
    [UrnType.FILE]: 'FolderIcon',
    [UrnType.CHAT]: 'ChatBubbleLeftRightIcon',
    [UrnType.USER]: 'UserIcon',
    [UrnType.BOOK]: 'BookOpenIcon',
    [UrnType.CALENDAR_EVENT]: 'CalendarIcon',
    [UrnType.PASSWORD]: 'KeyIcon',
    [UrnType.SPACE]: 'CubeIcon',
    [UrnType.UNKNOWN]: 'QuestionMarkCircleIcon',
  };

  return iconMap[parsed.type];
}

/**
 * Get human-readable type label for URN
 */
export function getUrnTypeLabel(urn: string): string {
  const parsed = parseUrn(urn);

  const labelMap: Record<UrnType, string> = {
    [UrnType.NOTE]: 'Note',
    [UrnType.FILE]: 'File',
    [UrnType.CHAT]: 'Chat',
    [UrnType.USER]: 'User',
    [UrnType.BOOK]: 'Book',
    [UrnType.CALENDAR_EVENT]: 'Event',
    [UrnType.PASSWORD]: 'Password',
    [UrnType.SPACE]: 'Space',
    [UrnType.UNKNOWN]: 'Unknown',
  };

  return labelMap[parsed.type];
}

/**
 * Validate if a string is a valid UWOS URN
 */
export function isValidUrn(urn: string): boolean {
  return parseUrn(urn).isValid;
}
