import type { Timestamp } from "@bufbuild/protobuf/wkt";
import { formatRelativeSeconds } from "@shared/lib/dateFormatting";
import type { Comment as ProtoComment } from "@uniffy/proto/comments/v1/comments_pb";

export interface SerializedReaction {
  emoji: string;
  count: number;
  currentUserReacted: boolean;
}

export interface SerializedComment {
  id: string;
  authorId: string;
  authorName: string;
  authorAvatarUrl: string | null;
  body: string;
  isResolved: boolean;
  resolvedByName: string | null;
  createdAtSeconds: number;
  timeLabel: string;
  isEdited: boolean;
  replyCount: number;
  reactions: SerializedReaction[];
  replies: SerializedComment[];
}

function tsToSeconds(ts: Timestamp | undefined): number {
  if (!ts) return 0;
  return typeof ts.seconds === "bigint" ? Number(ts.seconds) : ts.seconds;
}

export function commentToPlain(proto: ProtoComment): SerializedComment {
  const createdAtSeconds = tsToSeconds(proto.createdAt);
  return {
    id: proto.id,
    authorId: proto.authorId,
    authorName: proto.authorName || "Unknown",
    authorAvatarUrl: proto.authorAvatarUrl || null,
    // Canonical body with [[[label|urn]]] mentions preserved so the sheet can
    // render them as navigable chips.
    body: proto.body,
    isResolved: proto.isResolved,
    resolvedByName: proto.resolvedByName || null,
    createdAtSeconds,
    timeLabel: formatRelativeSeconds(createdAtSeconds),
    isEdited: !!proto.updatedAt && tsToSeconds(proto.updatedAt) > createdAtSeconds + 1,
    replyCount: proto.replyCount,
    reactions: proto.reactions.map((r) => ({
      emoji: r.emoji,
      count: r.count,
      currentUserReacted: r.currentUserReacted,
    })),
    replies: proto.replies.map(commentToPlain),
  };
}
