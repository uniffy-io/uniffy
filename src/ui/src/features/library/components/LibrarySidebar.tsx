import { useCallback, useMemo } from "react";
import { Link } from "react-router-dom";
import { BookmarkSimple, Graph, Tag } from "@phosphor-icons/react";
import type { Icon } from "@phosphor-icons/react";
import { cn } from "@/shared/utils/cn";
import { BookmarkTypeFilters } from "@/features/bookmarks/components/BookmarkTypeFilters";
import { useSavedTypesFilter } from "@/features/bookmarks/hooks/useSavedTypesFilter";
import {
  bookmarkTypesToContentTypes,
  contentTypesToBookmarkTypes,
} from "@/features/bookmarks/utils/bookmarkTypes";
import { useGraphFilterTypes } from "@/features/library/hooks/useGraphFilterTypes";
import { useTagFilterState } from "@/features/tags/hooks/useTagFilterState";
import { TAG_FILTER_TYPES } from "@/features/tags/utils/filterTypes";
import type { UrnType } from "@/shared/utils/urnTypes";

export type LibraryTab = "saved" | "tags" | "graph";

interface SidebarNavLinkProps {
  to: string;
  icon: Icon;
  label: string;
  active: boolean;
  testId: string;
}

function SidebarNavLink({ to, icon: IconComponent, label, active, testId }: SidebarNavLinkProps) {
  return (
    <Link
      to={to}
      aria-current={active ? "page" : undefined}
      data-testid={testId}
      className={cn(
        "group/nav flex items-center gap-2.5 rounded-md px-3 py-2 transition-colors",
        active ? "bg-primary/10" : "hover:bg-accent",
      )}
    >
      <IconComponent
        size={16}
        weight={active ? "fill" : "duotone"}
        className={cn(
          active ? "text-primary" : "text-muted-foreground group-hover/nav:text-foreground",
        )}
      />
      <span
        className={cn(
          "min-w-0 truncate text-sm font-medium",
          active ? "text-foreground" : "text-muted-foreground group-hover/nav:text-foreground",
        )}
      >
        {label}
      </span>
    </Link>
  );
}

export function LibrarySidebar({ tab }: { tab: LibraryTab }) {
  const saved = useSavedTypesFilter();
  const graphTypes = useGraphFilterTypes();
  const { criteria, patch } = useTagFilterState();

  const tagSelected = useMemo(
    () => contentTypesToBookmarkTypes(criteria.contentTypes),
    [criteria.contentTypes],
  );
  const handleTagTypesChange = useCallback(
    (types: UrnType[]) => {
      patch({ contentTypes: bookmarkTypesToContentTypes(types) });
    },
    [patch],
  );

  return (
    <div className="flex h-full flex-col">
      <div className="px-4 pb-2 pt-4">
        <h1 className="text-sm font-semibold tracking-tight text-foreground">Library</h1>
      </div>

      <nav className="flex flex-col gap-0.5 px-2" aria-label="Library sections">
        <SidebarNavLink
          to="/library"
          icon={BookmarkSimple}
          label="Bookmarks"
          active={tab === "saved"}
          testId="library-tab-saved"
        />
        <SidebarNavLink
          to="/library/tags"
          icon={Tag}
          label="Tags"
          active={tab === "tags"}
          testId="library-tab-tags"
        />
        <SidebarNavLink
          to="/library/graph"
          icon={Graph}
          label="Knowledge Graph"
          active={tab === "graph"}
          testId="library-tab-graph"
        />
      </nav>

      {(tab !== "graph" || graphTypes.length > 0) && (
        <>
          <div className="mt-6 px-4 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Filter by type
          </div>
          <div className="mt-2 min-h-0 flex-1 overflow-y-auto pb-4 pr-3">
            {tab === "saved" ? (
              <BookmarkTypeFilters
                orientation="side"
                selected={saved.selected}
                onChange={saved.setSelected}
              />
            ) : tab === "tags" ? (
              <BookmarkTypeFilters
                orientation="side"
                types={TAG_FILTER_TYPES}
                selected={tagSelected}
                onChange={handleTagTypesChange}
              />
            ) : (
              <BookmarkTypeFilters
                orientation="side"
                types={graphTypes}
                selected={saved.selected}
                onChange={saved.setSelected}
              />
            )}
          </div>
        </>
      )}
    </div>
  );
}
