import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { createPortal } from "react-dom";
import { Hash, LockSimple, X, MagnifyingGlass, Check, Warning, Plus } from "@phosphor-icons/react";
import { useAppDispatch, useAppSelector } from "@/app/hooks";
import { cn } from "@/shared/utils/cn";
import { Input } from "@/components/ui/input";
import { selectChannels } from "@/features/chat/store/chatChannelsSlice";
import { fetchChannels, fetchMembers, createChannel } from "@/features/chat/store/chatThunks";
import { countMissingAttendees } from "@/features/calendar/utils/meeting";
import { ChannelType as ProtoChannelType } from "@uniffy/proto/chat/v1/chat_pb";
import type { ChatChannel } from "@/features/chat/types";
import type { RootState } from "@/app/store";

interface MeetingChannelPickerProps {
  selectedChannelId: string | null;
  onSelect: (channelId: string | null) => void;
  /** Marks a channel the picker just auto-created as a meeting room. */
  onCreateRoom: (channelId: string) => void;
  /** Attendee user ids: seed a new room's membership and diff for the access warning. */
  attendeeIds: string[];
  /** Event title, used to name an auto-created room. */
  eventTitle: string;
  className?: string;
}

function channelLabel(channel: ChatChannel): string {
  return channel.customName?.trim() || channel.name;
}

export function MeetingChannelPicker({
  selectedChannelId,
  onSelect,
  onCreateRoom,
  attendeeIds,
  eventTitle,
  className,
}: MeetingChannelPickerProps) {
  const dispatch = useAppDispatch();
  const channels = useAppSelector(selectChannels);
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [creating, setCreating] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ top: number; left: number; width: number } | null>(
    null,
  );

  const fetchedChannels = useRef(false);
  useEffect(() => {
    if (fetchedChannels.current) return;
    fetchedChannels.current = true;
    dispatch(fetchChannels());
  }, [dispatch]);

  // Bindable targets are real conversations, never agent DMs or archived rooms.
  const bindableChannels = useMemo(
    () => channels.filter((c) => !c.isAgentDm && !c.isArchived),
    [channels],
  );

  const selectedChannel = useMemo(
    () => (selectedChannelId ? (channels.find((c) => c.id === selectedChannelId) ?? null) : null),
    [channels, selectedChannelId],
  );

  const filteredChannels = useMemo(() => {
    if (!search.trim()) return bindableChannels;
    const q = search.toLowerCase();
    return bindableChannels.filter((c) => channelLabel(c).toLowerCase().includes(q));
  }, [bindableChannels, search]);

  // Private channels gate on membership, so diff attendees against members to
  // warn about who cannot join. Public channels are open to the org.
  const members = useAppSelector((state: RootState) =>
    selectedChannelId ? state.chatChannels.channelMembers[selectedChannelId] : undefined,
  );
  const fetchedMembersFor = useRef<string | null>(null);
  useEffect(() => {
    if (!selectedChannel || selectedChannel.channelType === "PUBLIC") return;
    if (fetchedMembersFor.current === selectedChannel.id) return;
    fetchedMembersFor.current = selectedChannel.id;
    dispatch(fetchMembers(selectedChannel.id));
  }, [dispatch, selectedChannel]);

  const missingAttendees = useMemo(
    () =>
      selectedChannel
        ? countMissingAttendees(selectedChannel.channelType, members, attendeeIds)
        : 0,
    [selectedChannel, members, attendeeIds],
  );

  const updatePosition = useCallback(() => {
    if (!buttonRef.current) return;
    const rect = buttonRef.current.getBoundingClientRect();
    setPosition({
      top: rect.bottom + 4,
      left: rect.left,
      width: Math.max(rect.width, 320),
    });
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    updatePosition();
    const handleScroll = () => updatePosition();
    window.addEventListener("scroll", handleScroll, true);
    window.addEventListener("resize", handleScroll);
    return () => {
      window.removeEventListener("scroll", handleScroll, true);
      window.removeEventListener("resize", handleScroll);
    };
  }, [isOpen, updatePosition]);

  useEffect(() => {
    if (!isOpen) return;
    function handleClick(e: MouseEvent) {
      if (
        buttonRef.current &&
        !buttonRef.current.contains(e.target as Node) &&
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node)
      ) {
        setIsOpen(false);
      }
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") setIsOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKey);
    };
  }, [isOpen]);

  const handleSelect = (channel: ChatChannel) => {
    onSelect(channel.id);
    setIsOpen(false);
    setSearch("");
  };

  const handleClear = (e: React.MouseEvent) => {
    e.stopPropagation();
    onSelect(null);
  };

  const handleCreateRoom = async () => {
    if (creating) return;
    setCreating(true);
    try {
      const room = await dispatch(
        createChannel({
          name: eventTitle.trim() || "Meeting",
          channelType: ProtoChannelType.PRIVATE,
          memberIds: attendeeIds,
        }),
      ).unwrap();
      onCreateRoom(room.id);
    } finally {
      setCreating(false);
    }
  };

  const dropdown =
    isOpen && position
      ? createPortal(
          <div
            ref={dropdownRef}
            style={{
              position: "fixed",
              top: position.top,
              left: position.left,
              width: position.width,
            }}
            className={cn(
              "z-200 rounded-lg border border-border bg-card shadow-xl",
              "animate-in fade-in-0 slide-in-from-top-2 duration-100",
            )}
          >
            <div className="p-2 border-b border-border">
              <div className="relative">
                <MagnifyingGlass
                  size={14}
                  className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"
                />
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search channels..."
                  className="h-8 pl-8 text-sm"
                  autoFocus
                />
              </div>
            </div>

            <div className="max-h-60 overflow-y-auto py-1">
              {filteredChannels.length === 0 ? (
                <div className="px-3 py-4 text-center text-sm text-muted-foreground">
                  No channels found
                </div>
              ) : (
                filteredChannels.map((channel) => {
                  const isSelected = channel.id === selectedChannelId;
                  const Icon = channel.channelType === "PUBLIC" ? Hash : LockSimple;
                  return (
                    <button
                      key={channel.id}
                      type="button"
                      onClick={() => handleSelect(channel)}
                      className={cn(
                        "flex w-full items-center gap-3 px-3 py-2 text-left transition-colors",
                        isSelected ? "bg-primary/10" : "hover:bg-muted",
                      )}
                    >
                      <Icon size={16} weight="duotone" className="text-muted-foreground shrink-0" />
                      <span className="text-sm font-medium text-foreground truncate flex-1">
                        {channelLabel(channel)}
                      </span>
                      {isSelected && (
                        <Check size={16} weight="bold" className="text-primary shrink-0" />
                      )}
                    </button>
                  );
                })
              )}
            </div>
          </div>,
          document.body,
        )
      : null;

  return (
    <div className={cn("space-y-2", className)}>
      <div className="relative">
        {selectedChannel ? (
          <div className="flex items-center gap-2 rounded-lg border border-border bg-background px-3 py-1.5">
            {selectedChannel.channelType === "PUBLIC" ? (
              <Hash size={14} weight="duotone" className="text-muted-foreground shrink-0" />
            ) : (
              <LockSimple size={14} weight="duotone" className="text-muted-foreground shrink-0" />
            )}
            <span className="text-sm font-medium text-foreground truncate flex-1">
              {channelLabel(selectedChannel)}
            </span>
            <button
              type="button"
              onClick={handleClear}
              className="p-0.5 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            >
              <X size={14} weight="bold" />
            </button>
          </div>
        ) : (
          <button
            ref={buttonRef}
            type="button"
            onClick={() => setIsOpen(!isOpen)}
            className={cn(
              "flex items-center gap-2 rounded-lg border border-border bg-background px-3 py-2 w-full",
              "text-sm text-muted-foreground hover:bg-muted/50 transition-colors",
              "focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1 focus:ring-offset-background",
            )}
          >
            <Hash size={16} weight="duotone" />
            <span>Select a channel...</span>
          </button>
        )}

        {dropdown}
      </div>

      {!selectedChannel && (
        <button
          type="button"
          onClick={handleCreateRoom}
          disabled={creating}
          className="flex items-center gap-1.5 text-xs font-medium text-primary hover:text-primary/80 transition-colors disabled:opacity-50"
        >
          <Plus size={14} weight="bold" />
          {creating ? "Creating room..." : "Create a meeting room from attendees"}
        </button>
      )}

      {missingAttendees > 0 && selectedChannel && (
        <div className="flex items-start gap-2 rounded-lg bg-yellow-100 dark:bg-yellow-900/30 px-3 py-2 text-xs text-yellow-800 dark:text-yellow-400">
          <Warning size={14} weight="duotone" className="shrink-0 mt-0.5" />
          <span>
            {missingAttendees} {missingAttendees === 1 ? "attendee" : "attendees"} cannot access{" "}
            {channelLabel(selectedChannel)}. Add them to the channel so they can join.
          </span>
        </div>
      )}
    </div>
  );
}
