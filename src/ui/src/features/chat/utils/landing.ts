import type { ChatChannel } from "@/features/chat/types";

export function chooseChatLanding(
  channels: ChatChannel[],
  lastOpenedId: string | null,
): string | null {
  if (lastOpenedId && channels.some((channel) => channel.id === lastOpenedId)) {
    return lastOpenedId;
  }

  return channels[0]?.id ?? null;
}
