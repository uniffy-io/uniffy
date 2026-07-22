import type { Icon } from '@phosphor-icons/react';
import {
  NotePencil,
  Folder,
  FolderSimple,
  ChatTeardrop,
  ChatText,
  User,
  CalendarDots,
  Kanban,
  CheckSquare,
  Brain,
  Notebook,
  Door,
  Question,
  Robot,
  Tag as TagIcon,
} from '@phosphor-icons/react';
import { UrnType } from '@/shared/utils/urnTypes';
import { getUrnTypeTheme, getUrnTypeHexColor, type UrnTypeTheme } from '@/config/theme/urnColors';

export interface ContentTypeConfig {
  type: UrnType;
  icon: Icon;
  label: string;
  labelPlural: string;
  route: string;
  theme: UrnTypeTheme;
  hexColor: string;
}

export const CONTENT_TYPE_CONFIG: Record<UrnType, ContentTypeConfig> = {
  [UrnType.NOTE]: {
    type: UrnType.NOTE,
    icon: NotePencil,
    label: 'Note',
    labelPlural: 'Notes',
    route: 'notes',
    theme: getUrnTypeTheme(UrnType.NOTE),
    hexColor: getUrnTypeHexColor(UrnType.NOTE),
  },
  [UrnType.FILE]: {
    type: UrnType.FILE,
    icon: FolderSimple,
    label: 'File',
    labelPlural: 'Files',
    route: 'files',
    theme: getUrnTypeTheme(UrnType.FILE),
    hexColor: getUrnTypeHexColor(UrnType.FILE),
  },
  [UrnType.FOLDER]: {
    type: UrnType.FOLDER,
    icon: Folder,
    label: 'Folder',
    labelPlural: 'Folders',
    route: 'files',
    theme: getUrnTypeTheme(UrnType.FOLDER),
    hexColor: getUrnTypeHexColor(UrnType.FOLDER),
  },
  [UrnType.AGENT_FOLDER]: {
    type: UrnType.AGENT_FOLDER,
    icon: Folder,
    label: 'Agent Chat Folder',
    labelPlural: 'Agent Chat Folders',
    route: 'chat',
    theme: getUrnTypeTheme(UrnType.AGENT_FOLDER),
    hexColor: getUrnTypeHexColor(UrnType.AGENT_FOLDER),
  },
  [UrnType.CHAT]: {
    type: UrnType.CHAT,
    icon: ChatTeardrop,
    label: 'Chat',
    labelPlural: 'Chats',
    route: 'chat',
    theme: getUrnTypeTheme(UrnType.CHAT),
    hexColor: getUrnTypeHexColor(UrnType.CHAT),
  },
  [UrnType.USER]: {
    type: UrnType.USER,
    icon: User,
    label: 'User',
    labelPlural: 'Users',
    route: 'users',
    theme: getUrnTypeTheme(UrnType.USER),
    hexColor: getUrnTypeHexColor(UrnType.USER),
  },
  [UrnType.CALENDAR_EVENT]: {
    type: UrnType.CALENDAR_EVENT,
    icon: CalendarDots,
    label: 'Event',
    labelPlural: 'Events',
    route: 'calendar',
    theme: getUrnTypeTheme(UrnType.CALENDAR_EVENT),
    hexColor: getUrnTypeHexColor(UrnType.CALENDAR_EVENT),
  },
  [UrnType.PROJECT]: {
    type: UrnType.PROJECT,
    icon: Kanban,
    label: 'Project',
    labelPlural: 'Projects',
    route: 'projects',
    theme: getUrnTypeTheme(UrnType.PROJECT),
    hexColor: getUrnTypeHexColor(UrnType.PROJECT),
  },
  [UrnType.TASK]: {
    type: UrnType.TASK,
    icon: CheckSquare,
    label: 'Task',
    labelPlural: 'Tasks',
    route: 'projects',
    theme: getUrnTypeTheme(UrnType.TASK),
    hexColor: getUrnTypeHexColor(UrnType.TASK),
  },
  [UrnType.AGENT]: {
    type: UrnType.AGENT,
    icon: Brain,
    label: 'Agent',
    labelPlural: 'Agents',
    route: 'agents',
    theme: getUrnTypeTheme(UrnType.AGENT),
    hexColor: getUrnTypeHexColor(UrnType.AGENT),
  },
  [UrnType.PROMPT]: {
    type: UrnType.PROMPT,
    icon: Notebook,
    label: 'Prompt',
    labelPlural: 'Prompts',
    route: 'agents/prompts',
    theme: getUrnTypeTheme(UrnType.PROMPT),
    hexColor: getUrnTypeHexColor(UrnType.PROMPT),
  },
  [UrnType.AGENT_CHAT]: {
    type: UrnType.AGENT_CHAT,
    icon: Robot,
    label: 'Agent Chat',
    labelPlural: 'Agent Chats',
    route: 'chat',
    theme: getUrnTypeTheme(UrnType.AGENT_CHAT),
    hexColor: getUrnTypeHexColor(UrnType.AGENT_CHAT),
  },
  [UrnType.CHAT_MESSAGE]: {
    type: UrnType.CHAT_MESSAGE,
    icon: ChatText,
    label: 'Message',
    labelPlural: 'Messages',
    route: 'chat',
    theme: getUrnTypeTheme(UrnType.CHAT),
    hexColor: getUrnTypeHexColor(UrnType.CHAT),
  },
  [UrnType.ROOM]: {
    type: UrnType.ROOM,
    icon: Door,
    label: 'Room',
    labelPlural: 'Rooms',
    route: 'rooms',
    theme: getUrnTypeTheme(UrnType.ROOM),
    hexColor: getUrnTypeHexColor(UrnType.ROOM),
  },
  [UrnType.TAG]: {
    type: UrnType.TAG,
    icon: TagIcon,
    label: 'Tag',
    labelPlural: 'Tags',
    route: 'tags',
    theme: getUrnTypeTheme(UrnType.TAG),
    hexColor: getUrnTypeHexColor(UrnType.TAG),
  },
  [UrnType.UNKNOWN]: {
    type: UrnType.UNKNOWN,
    icon: Question,
    label: 'Unknown',
    labelPlural: 'Items',
    route: '',
    theme: getUrnTypeTheme(UrnType.UNKNOWN),
    hexColor: getUrnTypeHexColor(UrnType.UNKNOWN),
  },
};

export function getContentTypeConfig(type: UrnType): ContentTypeConfig {
  return CONTENT_TYPE_CONFIG[type] || CONTENT_TYPE_CONFIG[UrnType.UNKNOWN];
}

export function getContentTypeIcon(type: UrnType): Icon {
  return getContentTypeConfig(type).icon;
}

export function getContentTypeLabel(type: UrnType): string {
  return getContentTypeConfig(type).label;
}

export function getContentTypeLabelPlural(type: UrnType): string {
  return getContentTypeConfig(type).labelPlural;
}

export function getContentTypeRoute(type: UrnType): string {
  return getContentTypeConfig(type).route;
}

export const NAVIGABLE_CONTENT_TYPES: ContentTypeConfig[] = Object.values(CONTENT_TYPE_CONFIG)
  .filter((config) => config.type !== UrnType.UNKNOWN);
