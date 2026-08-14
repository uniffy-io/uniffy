import type { ChatChannel } from "@/features/chat/types";

/** Prefer the user's customName over the auto-generated `name`. */
export function getChannelDisplayName(channel: ChatChannel): string {
  const custom = channel.customName?.trim();
  if (custom) return custom;
  return channel.name;
}
