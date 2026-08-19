import { useState, useCallback, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import { MagnifyingGlass, X } from "@phosphor-icons/react";
import { cn } from "@/shared/utils/cn";
import { useAppDispatch } from "@/app/hooks";
import { useChatSearch } from "@/features/chat/hooks/useChatSearch";
import {
  ChatSearchFilters,
  type ChatSearchFilterValues,
} from "@/features/chat/components/search/ChatSearchFilters";
import { ChatSearchResultItem } from "@/features/chat/components/search/ChatSearchResultItem";
import { jumpToChannelMessage } from "@/features/chat/store/chatThunks";

interface ChatSearchPanelProps {
  channelId?: string;
  channelName?: string;
  anchorRef: React.RefObject<HTMLElement | null>;
  onClose: () => void;
}

export function ChatSearchPanel({
  channelId,
  channelName,
  anchorRef,
  onClose,
}: ChatSearchPanelProps) {
  const dispatch = useAppDispatch();
  const panelRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState("");
  const [focusedIndex, setFocusedIndex] = useState(-1);
  const [filters, setFilters] = useState<ChatSearchFilterValues>(channelId ? { channelId } : {});

  const { results, isLoading, error, resultCount, hasMore, search, clear } = useChatSearch();

  const [position, setPosition] = useState({ top: 100, left: 100 });

  useEffect(() => {
    const anchor = anchorRef.current;
    if (!anchor) return;

    const rect = anchor.getBoundingClientRect();
    const panelWidth = 420;

    let left = rect.right - panelWidth;
    if (left + panelWidth > window.innerWidth - 16) {
      left = window.innerWidth - panelWidth - 16;
    }
    if (left < 16) left = 16;

    setPosition({ top: rect.bottom + 6, left });
  }, [anchorRef]);

  useEffect(() => {
    const timer = setTimeout(() => inputRef.current?.focus(), 50);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (query.trim()) {
      search(query, filters);
    } else {
      clear();
    }
    // eslint-disable-next-line react/react-compiler -- reset keyboard focus when search criteria change
    setFocusedIndex(-1);
  }, [query, filters, search, clear]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const timer = setTimeout(() => {
      document.addEventListener("mousedown", handleClickOutside);
    }, 0);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [onClose]);

  const handleNavigate = useCallback(
    (targetChannelId: string, messageId: string) => {
      dispatch(jumpToChannelMessage({ channelId: targetChannelId, messageId }));
      onClose();
    },
    [dispatch, onClose],
  );

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
        return;
      }

      if (results.length === 0) return;

      if (e.key === "ArrowDown") {
        e.preventDefault();
        setFocusedIndex((prev) => (prev < results.length - 1 ? prev + 1 : 0));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setFocusedIndex((prev) => (prev > 0 ? prev - 1 : results.length - 1));
      } else if (e.key === "Enter" && focusedIndex >= 0) {
        e.preventDefault();
        const focused = results[focusedIndex];
        const cId = focused?.metadata?.channel_id;
        const mId = focused?.urn.split(":").pop();
        if (cId && mId) {
          handleNavigate(cId, mId);
        }
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose, results, focusedIndex, handleNavigate]);

  useEffect(() => {
    if (focusedIndex < 0 || !resultsRef.current) return;
    const items = resultsRef.current.querySelectorAll("[data-search-result]");
    items[focusedIndex]?.scrollIntoView({ block: "nearest" });
  }, [focusedIndex]);

  const handleClear = useCallback(() => {
    setQuery("");
    inputRef.current?.focus();
  }, []);

  const showChannel = !filters.channelId;

  return createPortal(
    <div
      ref={panelRef}
      className="fixed z-[100] w-[420px] max-w-[calc(100vw-2rem)] max-h-[70vh] bg-card border border-border rounded-xl shadow-xl overflow-hidden flex flex-col"
      style={{ top: position.top, left: position.left }}
      data-testid="chat-search-popover"
      data-loading={isLoading ? "true" : "false"}
    >
      <div className="px-3 pt-3 pb-2">
        <div className="relative">
          <MagnifyingGlass
            size={16}
            className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"
          />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search messages..."
            className={cn(
              "w-full pl-8 pr-8 py-2 rounded-lg text-sm",
              "bg-muted border border-border text-foreground placeholder:text-muted-foreground",
              "focus:outline-none focus:ring-1 focus:ring-ring focus:border-transparent",
            )}
            data-testid="chat-search-input"
          />
          {query && (
            <button
              type="button"
              onClick={handleClear}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
              data-testid="chat-search-clear"
            >
              <X size={14} />
            </button>
          )}
        </div>
      </div>

      <div className="px-2 pb-2">
        <ChatSearchFilters
          activeChannelId={channelId}
          activeChannelName={channelName}
          filters={filters}
          onFiltersChange={setFilters}
        />
      </div>

      <div className="border-t border-border" />

      <div ref={resultsRef} className="flex-1 overflow-y-auto">
        {isLoading && (
          <div className="px-3 py-4 space-y-3">
            {[0, 1, 2].map((i) => (
              <div key={i} className="flex items-start gap-2.5 px-3 py-2">
                <div className="w-6 h-6 rounded-full bg-muted animate-pulse shrink-0" />
                <div className="flex-1 space-y-1.5">
                  <div className="h-3 bg-muted rounded animate-pulse w-2/5" />
                  <div className="h-3 bg-muted rounded animate-pulse w-4/5" />
                </div>
              </div>
            ))}
          </div>
        )}

        {!isLoading && error && (
          <div className="px-4 py-8 text-center">
            <p className="text-sm text-muted-foreground">Search failed. Try again.</p>
          </div>
        )}

        {!isLoading && !error && query.trim() && results.length === 0 && (
          <div className="px-4 py-8 text-center">
            <MagnifyingGlass size={28} className="mx-auto mb-2 text-muted-foreground/30" />
            <p className="text-sm text-muted-foreground">No messages found</p>
          </div>
        )}

        {!isLoading && results.length > 0 && (
          <div className="py-1">
            <div className="px-4 py-1">
              <span className="text-xs text-muted-foreground">
                {hasMore
                  ? `Showing first ${resultCount} results`
                  : `${resultCount} ${resultCount === 1 ? "result" : "results"}`}
              </span>
            </div>
            {results.map((result, index) => (
              <div
                key={result.urn}
                data-search-result
                data-testid={`chat-search-result-${result.urn}`}
                data-focused={index === focusedIndex ? "true" : "false"}
              >
                <ChatSearchResultItem
                  result={result}
                  query={query}
                  showChannel={showChannel}
                  isFocused={index === focusedIndex}
                  onNavigate={handleNavigate}
                />
              </div>
            ))}
          </div>
        )}

        {!isLoading && !query.trim() && (
          <div className="px-4 py-8 text-center">
            <MagnifyingGlass size={28} className="mx-auto mb-2 text-muted-foreground/30" />
            <p className="text-sm text-foreground font-medium">Search messages</p>
            <p className="text-xs text-muted-foreground mt-1">
              Find messages in {filters.channelId ? "this channel" : "all channels"}
            </p>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
