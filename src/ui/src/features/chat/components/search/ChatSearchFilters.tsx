import { useState, useCallback, useRef } from "react";
import { X, Hash, Globe, User } from "@phosphor-icons/react";
import { SubjectPicker } from "@/components/subject";
import { cn } from "@/shared/utils/cn";
import type { Subject } from "@/components/subject/types";

export interface ChatSearchFilterValues {
  channelId?: string;
  senderId?: string;
}

interface ChatSearchFiltersProps {
  activeChannelId?: string;
  activeChannelName?: string;
  filters: ChatSearchFilterValues;
  onFiltersChange: (filters: ChatSearchFilterValues) => void;
}

export function ChatSearchFilters({
  activeChannelId,
  activeChannelName,
  filters,
  onFiltersChange,
}: ChatSearchFiltersProps) {
  const [showSenderPicker, setShowSenderPicker] = useState(false);
  const senderBtnRef = useRef<HTMLButtonElement>(null);

  const isChannelScoped = filters.channelId === activeChannelId && !!activeChannelId;

  const handleToggleChannelScope = useCallback(() => {
    if (isChannelScoped) {
      onFiltersChange({ ...filters, channelId: undefined });
    } else if (activeChannelId) {
      onFiltersChange({ ...filters, channelId: activeChannelId });
    }
  }, [filters, isChannelScoped, activeChannelId, onFiltersChange]);

  const handleSenderSelect = useCallback(
    (_ids: string[], subjects: Subject[]) => {
      if (subjects.length > 0) {
        onFiltersChange({ ...filters, senderId: subjects[0].id });
      }
      setShowSenderPicker(false);
    },
    [filters, onFiltersChange],
  );

  const handleClearSender = useCallback(() => {
    onFiltersChange({ ...filters, senderId: undefined });
  }, [filters, onFiltersChange]);

  const handleClearAll = useCallback(() => {
    onFiltersChange({});
  }, [onFiltersChange]);

  const hasFilters = !!filters.channelId || !!filters.senderId;

  const pillBase = "inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs transition-colors";
  const pillActive = "bg-primary/10 text-primary border border-primary/30";
  const pillInactive =
    "bg-muted text-muted-foreground border border-border hover:bg-muted/80 cursor-pointer";

  return (
    <div className="flex items-center gap-1.5 flex-wrap px-1" data-testid="chat-search-filters">
      {activeChannelId && (
        <button
          type="button"
          onClick={handleToggleChannelScope}
          className={cn(pillBase, isChannelScoped ? pillActive : pillInactive)}
          data-testid="chat-search-filter-channel-scope"
          data-active={isChannelScoped ? "true" : "false"}
        >
          {isChannelScoped ? <Hash size={12} /> : <Globe size={12} />}
          <span>{isChannelScoped ? (activeChannelName ?? "This channel") : "All channels"}</span>
        </button>
      )}

      {filters.senderId ? (
        <span className={cn(pillBase, pillActive)} data-testid="chat-search-filter-sender-active">
          <User size={12} />
          <span>From user</span>
          <button
            type="button"
            onClick={handleClearSender}
            className="hover:text-foreground transition-colors"
            data-testid="chat-search-filter-sender-clear"
          >
            <X size={10} />
          </button>
        </span>
      ) : (
        <>
          <button
            ref={senderBtnRef}
            type="button"
            onClick={() => setShowSenderPicker((prev) => !prev)}
            className={cn(pillBase, showSenderPicker ? pillActive : pillInactive)}
            data-testid="chat-search-filter-sender"
            data-state={showSenderPicker ? "open" : "closed"}
          >
            <User size={12} />
            <span>From</span>
          </button>
          {showSenderPicker && (
            <SubjectPicker
              mode="single"
              subjectTypes="users"
              placeholder="Filter by sender..."
              value={[]}
              onChange={handleSenderSelect}
              portal
              anchorRef={senderBtnRef}
              onClose={() => setShowSenderPicker(false)}
              autoFocus
            />
          )}
        </>
      )}

      {hasFilters && (
        <button
          type="button"
          onClick={handleClearAll}
          className="text-xs text-muted-foreground hover:text-foreground transition-colors"
          data-testid="chat-search-filter-clear-all"
        >
          Clear
        </button>
      )}
    </div>
  );
}
