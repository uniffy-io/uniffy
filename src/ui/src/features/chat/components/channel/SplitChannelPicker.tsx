import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { Hash, Lock, MagnifyingGlass } from "@phosphor-icons/react";
import { useAppSelector } from "@/app/hooks";
import { selectChannels } from "@/features/chat/store/chatChannelsSlice";
import { cn } from "@/shared/utils/cn";
import { SubjectAvatarById } from "@/components/subject";
import { Input } from "@/components/ui/input";
import type { ChatChannel } from "@/features/chat/types";

interface SplitChannelPickerProps {
  onSelect: (channelId: string) => void;
  onClose: () => void;
  currentChannelId: string;
}

export function SplitChannelPicker({
  onSelect,
  onClose,
  currentChannelId,
}: SplitChannelPickerProps) {
  const [search, setSearch] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const channels = useAppSelector(selectChannels);

  const filteredChannels = useMemo(() => {
    const query = search.toLowerCase();
    return channels
      .filter((c) => c.id !== currentChannelId)
      .filter((c) => !query || c.name.toLowerCase().includes(query));
  }, [channels, currentChannelId, search]);

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
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    // Defer registration so the opening click doesn't immediately close the picker.
    const timer = setTimeout(() => {
      document.addEventListener("mousedown", handleClick);
    }, 0);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("mousedown", handleClick);
    };
  }, [onClose]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  const handleSelect = useCallback(
    (channelId: string) => {
      onSelect(channelId);
    },
    [onSelect],
  );

  const renderChannelItem = (channel: ChatChannel) => {
    const isPrivate = channel.channelType === "PRIVATE";
    const isDm = channel.channelType === "DIRECT" || channel.channelType === "GROUP_DM";
    const Icon = isPrivate ? Lock : Hash;

    return (
      <button
        key={channel.id}
        type="button"
        onClick={() => handleSelect(channel.id)}
        className="flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-muted cursor-pointer w-full text-left transition-colors"
      >
        {!isDm && <Icon size={14} className="text-muted-foreground shrink-0" />}
        {isDm && (
          <SubjectAvatarById userId={channel.ownerId} displayName={channel.name} size="xs" />
        )}
        <span className="truncate text-foreground">{channel.name}</span>
      </button>
    );
  };

  return (
    <div
      ref={containerRef}
      className="absolute top-full right-0 mt-1 w-64 bg-card border border-border rounded-lg shadow-xl z-50 py-1 max-h-80 overflow-hidden flex flex-col"
    >
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
          />
        </div>
      </div>

      <div className="overflow-y-auto flex-1">
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
    </div>
  );
}
