import { useState, useRef, useEffect, useMemo } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { MagnifyingGlass, X } from "@phosphor-icons/react";
import { useSearch } from "@/features/search/hooks/useSearch";
import { SearchResultsList } from "@/features/search/components/SearchResultsList";
import { cn } from "@/shared/utils/cn";
import { useFormattedKeybinding } from "@/features/settings";
import { useAppDispatch, useAppSelector } from "@/app/hooks";
import { recordRecentItem } from "@/features/search/utils/recentItems";
import { openViewerWithFetch } from "@/features/files";
import { openRoomViewer } from "@/features/rooms/store/roomsThunks";
import { createChannel } from "@/features/chat/store/chatThunks";
import { ChannelType } from "@uniffy/proto/chat/v1/chat_pb";
import { SearchResultType } from "@uniffy/proto/search/v1/search_pb";
import type { SearchResultItem } from "@uniffy/proto/search/v1/search_pb";
import { getRouteTypePriority } from "@/features/search/utils/typePriority";

export function GlobalSearch() {
  const navigate = useNavigate();
  const dispatch = useAppDispatch();
  const location = useLocation();
  const [isOpen, setIsOpen] = useState(false);
  const [isFocused, setIsFocused] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const routePriority = getRouteTypePriority(location.pathname);
  const searchOptions = useMemo(
    () => (routePriority ? { typePriority: routePriority } : undefined),
    [routePriority],
  );

  const { query, setQuery, results, totalCount, isLoading, clearResults } =
    useSearch(searchOptions);
  const organizationId = useAppSelector((state) => state.auth.currentOrganizationId);
  const userId = useAppSelector((state) => state.auth.user?.id);
  const searchShortcut = useFormattedKeybinding("nav.search");

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
        setIsFocused(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const closeAfterSelect = () => {
    setIsOpen(false);
    setIsFocused(false);
    clearResults();
    inputRef.current?.blur();
  };

  const handleResultSelect = async (result: SearchResultItem) => {
    if (organizationId && userId) {
      recordRecentItem(organizationId, userId, {
        urn: result.urn,
        title: result.title,
        type: result.type,
        url: result.url,
      });
    }

    // Files open in the viewer modal so the user stays on the current page.
    if (result.type === SearchResultType.FILE) {
      const fileId = result.urn.split(":").pop();
      if (fileId) {
        dispatch(openViewerWithFetch({ fileId }));
      }
      closeAfterSelect();
      return;
    }

    // Rooms open in the viewer modal for the same reason.
    if (result.type === SearchResultType.ROOM) {
      const roomId = result.urn.split(":").pop();
      if (roomId) {
        dispatch(openRoomViewer({ roomId }));
        closeAfterSelect();
        return;
      }
    }

    // Users open the 1:1 DM (create_dm is idempotent for pairs).
    if (result.type === SearchResultType.USER) {
      const targetUserId = result.urn.split(":").pop();
      if (targetUserId) {
        try {
          const channel = await dispatch(
            createChannel({
              name: "",
              channelType: ChannelType.DIRECT,
              memberIds: [targetUserId],
            }),
          ).unwrap();
          navigate(`/chat/${channel.id}`);
          closeAfterSelect();
          return;
        } catch {
          // Fall through to default navigation.
        }
      }
    }

    navigate(result.url);
    closeAfterSelect();
  };

  const handleClose = () => {
    setIsOpen(false);
    setIsFocused(false);
    inputRef.current?.blur();
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setQuery(e.target.value);
    if (e.target.value.trim()) {
      setIsOpen(true);
    }
  };

  const handleClear = () => {
    clearResults();
    setIsOpen(false);
    inputRef.current?.focus();
  };

  return (
    <div ref={containerRef} className="relative">
      <div
        className={cn(
          "group relative flex items-center",
          "transition-all duration-500 ease-out",
          isFocused ? "w-[min(420px,calc(100vw-10rem))]" : "w-[min(384px,calc(100vw-12rem))]",
        )}
      >
        <div
          className={cn(
            "absolute -inset-1 rounded-xl opacity-0 blur-md transition-opacity duration-500",
            "bg-gradient-to-r from-primary/20 via-primary/10 to-primary/20",
            isFocused && "opacity-100",
          )}
        />

        <div
          className={cn(
            "relative w-full flex items-center rounded-lg overflow-hidden",
            "transition-all duration-300",
            isFocused
              ? "bg-card border border-primary/30 shadow-lg"
              : "bg-muted/60 border border-transparent hover:bg-muted/80",
          )}
        >
          <div
            className={cn(
              "flex items-center justify-center w-9 h-8 shrink-0",
              "transition-colors duration-300",
              isFocused ? "text-primary" : "text-muted-foreground",
            )}
          >
            <MagnifyingGlass size={16} weight={isFocused ? "bold" : "duotone"} />
          </div>

          <input
            ref={inputRef}
            type="text"
            id="global-search"
            name="global-search"
            autoComplete="off"
            value={query}
            onChange={handleInputChange}
            onFocus={() => {
              setIsFocused(true);
              if (query.trim()) setIsOpen(true);
            }}
            onBlur={() => !isOpen && setIsFocused(false)}
            placeholder="Search anything..."
            className={cn(
              "flex-1 h-8 bg-transparent text-sm",
              "placeholder:text-muted-foreground/50",
              "outline-none border-none",
              "transition-all duration-300",
            )}
          />

          <div className="flex items-center pr-2.5 gap-2">
            {query ? (
              <button
                onClick={handleClear}
                className={cn(
                  "p-1 rounded-md transition-all duration-200",
                  "text-muted-foreground hover:text-foreground",
                  "hover:bg-muted",
                )}
              >
                <X size={14} weight="bold" />
              </button>
            ) : (
              <kbd
                className={cn(
                  "hidden sm:inline-flex h-5 items-center gap-0.5 rounded-md px-1.5",
                  "text-[10px] font-medium tracking-wide",
                  "transition-all duration-300",
                  isFocused
                    ? "bg-primary/10 text-primary border border-primary/20"
                    : "bg-background/50 text-muted-foreground border border-border/50",
                )}
              >
                {searchShortcut || "⌘K"}
              </kbd>
            )}
          </div>
        </div>
      </div>

      {isOpen && (query.trim() || isLoading) && (
        <div
          className={cn(
            "absolute top-full left-1/2 -translate-x-1/2 mt-2 z-50",
            "w-[min(420px,calc(100vw-4rem))]",
          )}
        >
          <SearchResultsList
            results={results}
            isLoading={isLoading}
            query={query}
            onSelect={handleResultSelect}
            onClose={handleClose}
            className="max-h-[70vh]"
            showHeader={false}
            totalCount={totalCount}
          />
        </div>
      )}
    </div>
  );
}
