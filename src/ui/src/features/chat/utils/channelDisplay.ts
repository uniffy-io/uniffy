import type { ChatChannel } from "@/features/chat/types";

/** Prefer the user's customName over the auto-generated `name`. */
export function getChannelDisplayName(channel: ChatChannel): string {
  const custom = channel.customName?.trim();
  if (custom) return custom;
  return channel.name;
}

/** How a member's own conversation reads everywhere: "Ada Lovelace (you)". */
export function selfConversationLabel(fullName: string): string {
  const name = fullName.trim();
  return name ? `${name} (you)` : "You";
}

/**
 * A DM is named after everyone in it but the viewer; the stored name lists all
 * participants. The viewer's own conversation names the viewer instead.
 */
export function getDmDisplayName(channel: ChatChannel, currentUserName: string): string {
  if (channel.isSelfDm) return selfConversationLabel(currentUserName || channel.name);
  if (channel.isAgentDm) return getChannelDisplayName(channel);
  if (!currentUserName) return channel.name;
  const parts = channel.name.split(", ").filter((name) => name !== currentUserName);
  return parts.length > 0 ? parts.join(", ") : channel.name;
}

/** The person a 1:1 human DM is with; the viewer in their own conversation, else "". */
export function getDmPeerUserId(channel: ChatChannel, currentUserId: string): string {
  if (channel.isSelfDm) return currentUserId;
  if (channel.channelType !== "DIRECT" || channel.isAgentDm) return "";
  const peer = (channel.dmMemberIds ?? []).find((id) => !!id && id !== currentUserId);
  if (peer) return peer;
  if (channel.ownerId && channel.ownerId !== currentUserId) return channel.ownerId;
  return "";
}
