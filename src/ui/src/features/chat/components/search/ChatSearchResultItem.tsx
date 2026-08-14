import { Hash, Lock } from "@phosphor-icons/react";
import { SubjectAvatarById } from "@/components/subject";
import { formatRelativeTime } from "@/shared/utils/dateFormatting";
import { stripMarkdown } from "@/features/search/utils/stripMarkdown";
import { cn } from "@/shared/utils/cn";
import type { SearchResultItem } from "@uniffy/proto/search/v1/search_pb";

interface ChatSearchResultItemProps {
  result: SearchResultItem;
  query: string;
  showChannel: boolean;
  isFocused?: boolean;
  onNavigate: (channelId: string, messageId: string) => void;
}

function highlightMatch(text: string, query: string): React.ReactNode {
  if (!query.trim()) return text;
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const parts = text.split(new RegExp(`(${escaped})`, "gi"));
  return parts.map((part, i) =>
    part.toLowerCase() === query.toLowerCase() ? (
      <mark key={i} className="bg-primary/20 text-foreground rounded-sm px-0.5">
        {part}
      </mark>
    ) : (
      part
    ),
  );
}

export function ChatSearchResultItem({
  result,
  query,
  showChannel,
  isFocused = false,
  onNavigate,
}: ChatSearchResultItemProps) {
  const channelId = result.metadata?.channel_id;
  const channelName = result.metadata?.channel_name;
  const channelType = result.metadata?.channel_type;
  const senderId = result.metadata?.sender_id;
  const senderName = result.metadata?.sender_name || "Unknown";
  const messageId = result.urn.split(":").pop() ?? "";
  const content = stripMarkdown(result.description || result.title).slice(0, 200);

  const handleClick = () => {
    if (channelId && messageId) {
      onNavigate(channelId, messageId);
    }
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      className={cn(
        "w-full text-left flex items-start gap-2.5 px-3 py-2.5",
        "transition-colors cursor-pointer",
        isFocused ? "bg-muted" : "hover:bg-muted/50",
      )}
      data-testid={`chat-search-result-button-${messageId}`}
      data-focused={isFocused ? "true" : "false"}
    >
      {senderId && (
        <div className="shrink-0 mt-0.5">
          <SubjectAvatarById userId={senderId} displayName={senderName} size="sm" />
        </div>
      )}

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 mb-0.5">
          <span className="text-sm font-semibold text-foreground truncate">{senderName}</span>
          {showChannel && channelName && (
            <span className="flex items-center gap-0.5 text-[11px] text-muted-foreground shrink-0">
              {channelType === "PRIVATE" ? <Lock size={10} /> : <Hash size={10} />}
              {channelName}
            </span>
          )}
          <span className="text-[11px] text-muted-foreground shrink-0 ml-auto">
            {result.metadata?.updated_at ? formatRelativeTime(result.metadata.updated_at) : ""}
          </span>
        </div>

        <p className="text-sm text-muted-foreground leading-snug line-clamp-2">
          {highlightMatch(content, query)}
        </p>
      </div>
    </button>
  );
}
