import { useState, useRef, useEffect, useMemo } from "react";
import { Check, Hash, Lock, MagnifyingGlass } from "@phosphor-icons/react";
import { useAppSelector } from "@/app/hooks";
import { selectChannels } from "@/features/chat/store/chatChannelsSlice";
import { getChannelDisplayName } from "@/features/chat/utils/channelDisplay";
import { cn } from "@/shared/utils/cn";
import { SubjectAvatarById } from "@/components/subject";
import { Input } from "@/components/ui/input";
import type { ChatChannel } from "@/features/chat/types";

interface ChannelSelectListProps {
  onSelect: (channelId: string) => void;
  /** Rows failing this predicate are hidden; search filtering is applied on top. */
  filterChannel?: (channel: ChatChannel) => boolean;
  selectedChannelId?: string | null;
  autoFocus?: boolean;
  listClassName?: string;
}

export function ChannelSelectList({
  onSelect,
  filterChannel,
  selectedChannelId,
  autoFocus = false,
  listClassName,
}: ChannelSelectListProps) {
  const [search, setSearch] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const channels = useAppSelector(selectChannels);

  const filteredChannels = useMemo(() => {
    const query = search.toLowerCase();
    return channels
      .filter((c) => (filterChannel ? filterChannel(c) : true))
      .filter((c) => !query || getChannelDisplayName(c).toLowerCase().includes(query));
  }, [channels, filterChannel, search]);

  const channelGroups = useMemo(() => {
    const regular = filteredChannels.filter(
      (c) => c.channelType === "PUBLIC" || c.channelType === "PRIVATE",
    );
    const dms = filteredChannels.filter(
      (c) => c.channelType === "DIRECT" || c.channelType === "GROUP_DM",
    );
    return { regular, dms };
  }, [filteredChannels]);

  useEffect(() => {
    if (autoFocus) inputRef.current?.focus();
  }, [autoFocus]);

  const renderChannelItem = (channel: ChatChannel) => {
    const isPrivate = channel.channelType === "PRIVATE";
    const isDm = channel.channelType === "DIRECT" || channel.channelType === "GROUP_DM";
    const Icon = isPrivate ? Lock : Hash;
    const isSelected = selectedChannelId === channel.id;

    return (
      <button
        key={channel.id}
        type="button"
        onClick={() => onSelect(channel.id)}
        className={cn(
          "flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-muted cursor-pointer w-full text-left transition-colors",
          isSelected && "bg-primary/10",
        )}
        data-selected={isSelected ? "true" : "false"}
        data-testid={`chat-channel-select-item-${channel.id}`}
      >
        {!isDm && <Icon size={14} className="text-muted-foreground shrink-0" />}
        {isDm && (
          <SubjectAvatarById userId={channel.ownerId} displayName={channel.name} size="xs" />
        )}
        <span className="truncate text-foreground flex-1">{getChannelDisplayName(channel)}</span>
        {isSelected && <Check size={14} className="text-primary shrink-0" />}
      </button>
    );
  };

  return (
    <>
      <div className="px-2 py-1.5">
        <div className="relative">
          <MagnifyingGlass
            size={14}
            className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            ref={inputRef}
            type="text"
            placeholder="Search channels..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-7 pl-8 text-xs bg-muted/50"
            data-testid="chat-channel-select-search"
          />
        </div>
      </div>

      <div className={cn("overflow-y-auto flex-1", listClassName)}>
        {channelGroups.regular.length > 0 && (
          <div>
            <div className="px-3 py-1 text-[10px] uppercase font-medium tracking-wider text-muted-foreground">
              Channels
            </div>
            {channelGroups.regular.map(renderChannelItem)}
          </div>
        )}

        {channelGroups.dms.length > 0 && (
          <div>
            <div
              className={cn(
                "px-3 py-1 text-[10px] uppercase font-medium tracking-wider text-muted-foreground",
                channelGroups.regular.length > 0 && "mt-1",
              )}
            >
              Direct Messages
            </div>
            {channelGroups.dms.map(renderChannelItem)}
          </div>
        )}

        {filteredChannels.length === 0 && (
          <div className="px-3 py-4 text-center text-sm text-muted-foreground">
            No channels found
          </div>
        )}
      </div>
    </>
  );
}
