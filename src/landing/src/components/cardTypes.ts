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
  description?: string;
  tags?: string[];
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
  description?: string;
  tags?: string[];
};

export type ChatCard = {
  type: "chat";
  title: string;
  lastMessage: string;
  lastSender: string;
  updatedAt: string;
  memberCount?: number;
  tags?: string[];
};

export type DiagramCard = {
  type: "diagram";
  title: string;
  kind: string;
  updatedAt: string;
  description?: string;
  tags?: string[];
};

export type AgentCard = {
  type: "agent";
  title: string;
  model: string;
  status: "running" | "idle" | "offline";
  updatedAt: string;
  description?: string;
  tags?: string[];
};

export type TaskCard = {
  type: "task";
  title: string;
  status: "todo" | "in-progress" | "done" | "blocked";
  assignee?: string;
  dueDate?: string;
  updatedAt: string;
  description?: string;
  tags?: string[];
};

export type RoomCard = {
  type: "room";
  title: string;
  isLive: boolean;
  participants: number;
  updatedAt: string;
  description?: string;
  tags?: string[];
};

export type CardData =
  | NoteCard
  | FileCard
  | EventCard
  | UserCard
  | ProjectCard
  | ChatCard
  | DiagramCard
  | AgentCard
  | TaskCard
  | RoomCard;
