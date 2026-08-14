import { useEffect, useState, useCallback, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { X, FunnelSimple } from "@phosphor-icons/react";
import { useAppSelector, useAppDispatch } from "@/app/hooks";
import { closeResourcePanel } from "@/features/chat/store/chatUiSlice";
import { selectActiveChannel } from "@/features/chat/store/chatChannelsSlice";
import { fetchChannelResources } from "@/features/chat/store/chatThunks";
import { parseUrn, urnToPath, getUrnIcon, UrnType } from "@/shared/utils/urn";
import { openRoomViewer } from "@/features/rooms/store/roomsThunks";
import { getUrnTypeHexColor } from "@/config/theme/urnColors";
import { cn } from "@/shared/utils/cn";
import type { ChatResource } from "@/features/chat/types";

const CONTENT_TYPE_LABELS: Record<string, string> = {
  NOTE: "Notes",
  FILE: "Files",
  CALENDAR_EVENT: "Events",
  PROJECT: "Projects",
  TASK: "Tasks",
  USER: "People",
};

export function ResourcePanel() {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const activeChannel = useAppSelector(selectActiveChannel);
  const [allResources, setAllResources] = useState<ChatResource[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [filter, setFilter] = useState<string | null>(null);

  useEffect(() => {
    if (!activeChannel) return;
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- loading state tied to async fetch lifecycle
    setIsLoading(true);
    dispatch(
      fetchChannelResources({
        channelId: activeChannel.id,
        limit: 200,
      }),
    )
      .unwrap()
      .then((result) => {
        if (!cancelled) setAllResources(result.resources);
      })
      .catch(() => {
        if (!cancelled) setAllResources([]);
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [activeChannel, dispatch]);

  const availableTypes = useMemo(
    () => [...new Set(allResources.map((r) => r.contentType))],
    [allResources],
  );

  const resources = useMemo(
    () => (filter ? allResources.filter((r) => r.contentType === filter) : allResources),
    [allResources, filter],
  );

  const handleClose = useCallback(() => {
    dispatch(closeResourcePanel());
  }, [dispatch]);

  const handleResourceClick = useCallback(
    (urn: string) => {
      const parsed = parseUrn(urn);
      if (parsed.type === UrnType.ROOM && parsed.id) {
        dispatch(openRoomViewer({ roomId: parsed.id }));
        return;
      }
      const path = urnToPath(urn);
      if (path) navigate(path);
    },
    [dispatch, navigate],
  );

  const grouped = resources.reduce<Record<string, ChatResource[]>>((acc, r) => {
    const key = r.contentType;
    if (!acc[key]) acc[key] = [];
    acc[key].push(r);
    return acc;
  }, {});

  if (!activeChannel) return null;

  return (
    <div className="flex flex-col h-full bg-background">
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <span className="text-sm font-semibold text-foreground">Resources</span>
        <button
          onClick={handleClose}
          className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors shrink-0"
        >
          <X size={16} />
        </button>
      </div>

      {availableTypes.length > 1 && (
        <div className="flex items-center gap-1.5 px-4 py-2 border-b border-border overflow-x-auto">
          <FunnelSimple size={14} className="text-muted-foreground shrink-0" />
          <button
            onClick={() => setFilter(null)}
            className={cn(
              "px-2 py-0.5 text-xs rounded-full border transition-colors whitespace-nowrap",
              filter === null
                ? "bg-primary text-primary-foreground border-primary"
                : "border-border text-muted-foreground hover:text-foreground",
            )}
          >
            All
          </button>
          {availableTypes.map((type) => (
            <button
              key={type}
              onClick={() => setFilter(type)}
              className={cn(
                "px-2 py-0.5 text-xs rounded-full border transition-colors whitespace-nowrap",
                filter === type
                  ? "bg-primary text-primary-foreground border-primary"
                  : "border-border text-muted-foreground hover:text-foreground",
              )}
            >
              {CONTENT_TYPE_LABELS[type] ?? type}
            </button>
          ))}
        </div>
      )}

      <div className="flex-1 overflow-y-auto">
        {isLoading ? (
          <div className="py-8 text-center text-sm text-muted-foreground">Loading...</div>
        ) : resources.length === 0 ? (
          <div className="py-8 px-4 text-center">
            <p className="text-sm text-muted-foreground">No resources mentioned in this channel</p>
            <p className="text-xs text-muted-foreground/60 mt-1">
              Resources appear here when @mentioned in messages.
            </p>
          </div>
        ) : (
          Object.entries(grouped).map(([type, items]) => (
            <div key={type}>
              <div className="px-4 py-2 text-xs uppercase font-medium tracking-wider text-muted-foreground">
                {CONTENT_TYPE_LABELS[type] ?? type} ({items.length})
              </div>
              {items.map((resource) => {
                const parsed = parseUrn(resource.urn);
                const Icon = getUrnIcon(resource.urn);
                const hexColor = getUrnTypeHexColor(parsed.type);

                return (
                  <button
                    key={resource.id}
                    onClick={() => handleResourceClick(resource.urn)}
                    className="flex items-center gap-3 w-full px-4 py-2.5 hover:bg-muted/50 transition-colors text-left"
                  >
                    <span
                      className="p-1.5 rounded-md shrink-0"
                      style={{ backgroundColor: `${hexColor}20`, color: hexColor }}
                    >
                      <Icon size={14} />
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-foreground truncate">
                        {resource.title || parsed.id.substring(0, 8)}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Mentioned {resource.mentionCount}{" "}
                        {resource.mentionCount === 1 ? "time" : "times"}
                      </p>
                    </div>
                  </button>
                );
              })}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
