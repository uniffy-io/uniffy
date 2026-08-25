import { Link } from "react-router-dom";
import { BookmarkSimple, ArrowRight } from "@phosphor-icons/react";
import { cn } from "@/shared/utils/cn";
import { searchResultTypeToUrnType } from "@/shared/utils/searchResultTypes";
import { getContentTypeConfig } from "@/config/theme/contentTypes";
import {
  WidgetCard,
  EmptyWidget,
  WidgetSkeleton,
} from "@/features/dashboard/components/widgets/WidgetCard";
import { useBookmarkItems } from "@/features/bookmarks";
import type { SerializedBookmarkItem } from "@/features/bookmarks";
import { isDisplayableBookmarkItem } from "@/features/bookmarks/utils/bookmarkItems";

function BookmarkListItem({ item }: { item: SerializedBookmarkItem }) {
  const config = getContentTypeConfig(searchResultTypeToUrnType(item.content.type));
  const Icon = config.icon;

  return (
    <Link
      to={item.content.url}
      className={cn(
        "group flex items-center gap-3 rounded-lg p-2 -mx-2 transition-colors",
        "hover:bg-muted/50",
      )}
    >
      <div className={cn("rounded-md p-1.5", config.theme.badgeBg)}>
        <Icon size={16} weight="duotone" className={config.theme.accentText} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-foreground truncate group-hover:text-primary transition-colors">
          {item.content.title || `Untitled ${config.label.toLowerCase()}`}
        </p>
      </div>
      <span
        className={cn(
          "text-[10px] font-medium rounded px-1.5 py-0.5 shrink-0",
          config.theme.badgeBg,
          config.theme.accentText,
        )}
      >
        {config.label}
      </span>
    </Link>
  );
}

export function BookmarkedItemsWidget() {
  const { items, status } = useBookmarkItems("widget", { pageSize: 6 });

  const visibleItems = items.filter(isDisplayableBookmarkItem).slice(0, 6);

  const isLoading = status === "idle" || status === "loading";
  const isEmpty = visibleItems.length === 0 && !isLoading;

  return (
    <WidgetCard
      title="Bookmarked"
      icon={BookmarkSimple}
      colSpan={2}
      priority={2}
      footer={
        visibleItems.length > 0 ? (
          <Link
            to="/library"
            className="flex items-center gap-1 text-xs font-medium text-primary hover:text-primary/80 transition-colors"
          >
            View all bookmarks
            <ArrowRight size={12} />
          </Link>
        ) : null
      }
    >
      {isLoading && visibleItems.length === 0 ? (
        <WidgetSkeleton rows={4} />
      ) : isEmpty ? (
        <EmptyWidget
          icon={BookmarkSimple}
          title="No bookmarks yet"
          description="Save important items for quick access"
        />
      ) : (
        <div className="space-y-0.5">
          {visibleItems.map((item) => (
            <BookmarkListItem key={item.id} item={item} />
          ))}
        </div>
      )}
    </WidgetCard>
  );
}
