import { MemoryCategory, MemoryScope } from "@uniffy/proto/agents/v1/memories_pb";
import type { MemoryInfo } from "@uniffy/proto/agents/v1/memories_pb";

export interface SerializedMemory {
  id: string;
  key: string;
  content: string;
  description: string;
  category: MemoryCategory;
  pinned: boolean;
  createdByUserId: string;
  createdByName: string;
  createdByAgentName: string;
  updatedAtSeconds: number;
}

export const CATEGORY_LABELS: Record<number, string> = {
  [MemoryCategory.UNSPECIFIED]: "Unspecified",
  [MemoryCategory.PREFERENCES]: "Preferences",
  [MemoryCategory.FACTS]: "Facts",
  [MemoryCategory.CONTEXT]: "Context",
  [MemoryCategory.INSTRUCTIONS]: "Instructions",
};

export const EDITABLE_CATEGORIES: MemoryCategory[] = [
  MemoryCategory.PREFERENCES,
  MemoryCategory.FACTS,
  MemoryCategory.CONTEXT,
  MemoryCategory.INSTRUCTIONS,
];

export function memoryToPlain(proto: MemoryInfo): SerializedMemory {
  return {
    id: proto.id,
    key: proto.key,
    content: proto.content,
    description: proto.description,
    category: proto.category,
    pinned: proto.pinned,
    createdByUserId: proto.createdByUserId,
    createdByName: proto.createdByName,
    createdByAgentName: proto.createdByAgentName,
    updatedAtSeconds: proto.updatedAt ? Number(proto.updatedAt.seconds) : 0,
  };
}

/** The audience a chat surface reads and writes; mirrors the runtime's routing. */
export interface MemorySubject {
  scope: MemoryScope;
  subjectId?: string;
}

/**
 * A 1:1 agent DM is a personal surface (the caller's own memories, shared by
 * every agent they talk to); everything else is channel-shared.
 */
export function memorySubjectForChannel(
  channel: { isAgentDm: boolean; channelType: string } | null | undefined,
  channelId: string,
): MemorySubject {
  return channel?.isAgentDm && channel.channelType === "DIRECT"
    ? { scope: MemoryScope.USER }
    : { scope: MemoryScope.CHANNEL, subjectId: channelId };
}
