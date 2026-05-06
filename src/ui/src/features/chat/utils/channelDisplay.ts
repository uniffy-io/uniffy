import type { ChatChannel } from '@/features/chat/types';

/**
 * Resolve a channel's display name, preferring a user-set custom name over the
 * auto-generated `name` field. Used by the sidebar, channel header, breadcrumbs,
 * and any other surface that renders a chat channel's title.
 */
export function getChannelDisplayName(channel: ChatChannel): string {
  const custom = channel.customName?.trim();
  if (custom) return custom;
  return channel.name;
}
