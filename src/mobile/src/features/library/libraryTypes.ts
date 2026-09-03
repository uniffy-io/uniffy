import type React from "react";
import {
  CalendarDots,
  ChatTeardrop,
  ChatText,
  CheckSquare,
  Door,
  FileText,
  Folder,
  Kanban,
  NotePencil,
  Robot,
  Tag,
  Timer,
  User,
  UsersThree,
} from "phosphor-react-native";
import { ContentType } from "@uniffy/proto/common/v1/common_pb";
import type { UrnType } from "@shared/lib/contentTypes";
import { brandRampStops } from "@theme/brandRamp";

interface LibraryTypeConfig {
  label: string;
  labelPlural: string;
  icon: React.ComponentType<any>;
  contentType: ContentType;
}

export const LIBRARY_TYPES: Record<UrnType, LibraryTypeConfig> = {
  NOTE: { label: "Note", labelPlural: "Notes", icon: NotePencil, contentType: ContentType.NOTE },
  TAG: { label: "Tag", labelPlural: "Tags", icon: Tag, contentType: ContentType.TAG },
  FOLDER: {
    label: "Folder",
    labelPlural: "Folders",
    icon: Folder,
    contentType: ContentType.FOLDER,
  },
  FILE: { label: "File", labelPlural: "Files", icon: FileText, contentType: ContentType.FILE },
  PROJECT: {
    label: "Project",
    labelPlural: "Projects",
    icon: Kanban,
    contentType: ContentType.PROJECT,
  },
  TASK: { label: "Task", labelPlural: "Tasks", icon: CheckSquare, contentType: ContentType.TASK },
  CALENDAR_EVENT: {
    label: "Event",
    labelPlural: "Events",
    icon: CalendarDots,
    contentType: ContentType.CALENDAR_EVENT,
  },
  ROOM: { label: "Room", labelPlural: "Rooms", icon: Door, contentType: ContentType.ROOM },
  CHAT: { label: "Chat", labelPlural: "Chats", icon: ChatTeardrop, contentType: ContentType.CHAT },
  CHAT_MESSAGE: {
    label: "Message",
    labelPlural: "Messages",
    icon: ChatText,
    contentType: ContentType.CHAT_MESSAGE,
  },
  AGENT_FOLDER: {
    label: "Agent Chat Folder",
    labelPlural: "Agent Chat Folders",
    icon: Folder,
    contentType: ContentType.AGENT_FOLDER,
  },
  AGENT_CHAT: {
    label: "Agent Chat",
    labelPlural: "Agent Chats",
    icon: Robot,
    contentType: ContentType.AGENT_CHAT,
  },
  AGENT_CRON_TASK: {
    label: "Automation",
    labelPlural: "Automations",
    icon: Timer,
    contentType: ContentType.AGENT_CRON_TASK,
  },
  AGENT: { label: "Agent", labelPlural: "Agents", icon: Robot, contentType: ContentType.AGENT },
  TEAM: { label: "Team", labelPlural: "Teams", icon: UsersThree, contentType: ContentType.TEAM },
  USER: { label: "User", labelPlural: "People", icon: User, contentType: ContentType.USER },
};

// Order the brand-axis ramp walks, violet end to pink end. Identical to the
// web's BRAND_RAMP_ORDER so a type's hue is the same on both clients.
const BRAND_RAMP_ORDER: readonly UrnType[] = [
  "NOTE",
  "TAG",
  "FOLDER",
  "FILE",
  "PROJECT",
  "TASK",
  "CALENDAR_EVENT",
  "ROOM",
  "CHAT",
  "CHAT_MESSAGE",
  "AGENT_FOLDER",
  "AGENT_CHAT",
  "AGENT_CRON_TASK",
  "AGENT",
  "TEAM",
  "USER",
];

/** Ribbons offered on the bookmarks segment; the same set the web offers. */
export const BOOKMARK_FILTER_TYPES: UrnType[] = [
  "NOTE",
  "FILE",
  "FOLDER",
  "CHAT_MESSAGE",
  "CALENDAR_EVENT",
  "PROJECT",
  "TASK",
  "CHAT",
  "AGENT",
  "ROOM",
];

/** The content types tags can carry, offered by the tag ribbons. */
export const TAG_FILTER_TYPES: UrnType[] = [
  "NOTE",
  "FILE",
  "CALENDAR_EVENT",
  "CHAT",
  "AGENT",
  "PROJECT",
  "TASK",
];

const TYPE_COLORS: Record<UrnType, string> = Object.fromEntries(
  BRAND_RAMP_ORDER.map((type, index) => [
    type,
    brandRampStops(index, BRAND_RAMP_ORDER.length).start,
  ]),
) as Record<UrnType, string>;

/** The hue a type is painted with; null for a URN the library does not know. */
export function libraryTypeColor(type: UrnType | null): string | null {
  return type ? TYPE_COLORS[type] : null;
}

export function toContentTypes(types: UrnType[]): ContentType[] {
  return types.map((type) => LIBRARY_TYPES[type].contentType);
}
