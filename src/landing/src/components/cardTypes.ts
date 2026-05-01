export type NoteCard = {
  type: "note";
  title: string;
  description?: string;
  tags?: string[];
  updatedAt: string;
  updatedBy?: string;
  isBeingEdited?: boolean;
  editorName?: string;
};

export type FileCard = {
  type: "file";
  title: string;
  mime: string;
  size: string;
  updatedAt: string;
  thumbnailUrl?: string;
};

export type EventCard = {
  type: "event";
  title: string;
  timeRange: string;
  location?: string;
  meetingUrl?: string;
  description?: string;
  updatedAt: string;
  temporal?: string;
};

export type UserCard = {
  type: "user";
  title: string;
  email: string;
  presence: "online" | "away" | "dnd" | "offline";
  customStatus?: { emoji?: string; text: string };
};

export type ProjectCard = {
  type: "project";
  title: string;
  slug: string;
  completedTasks: number;
  totalTasks: number;
  updatedAt: string;
};

export type ChatCard = {
  type: "chat";
  title: string;
  lastMessage: string;
  lastSender: string;
  updatedAt: string;
  memberCount?: number;
};

export type CardData =
  | NoteCard
  | FileCard
  | EventCard
  | UserCard
  | ProjectCard
  | ChatCard;
