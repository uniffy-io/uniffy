import { Link, Navigate, useLocation } from "react-router-dom";
import { cn } from "@/shared/utils/cn";
import { useAppSelector } from "@/app/hooks";
import { useBreakpoint } from "@/shared/hooks/useBreakpoint";
import { lazyImport } from "@/shared/utils/lazyImport";
import { AppHeader } from "@/components/layout/AppHeader";
import { LazyRoute } from "@/components/feedback";
import { BookmarkTypeFilters } from "@/features/bookmarks/components/BookmarkTypeFilters";
import { useSavedTypesFilter } from "@/features/bookmarks/hooks/useSavedTypesFilter";
import { useGraphFilterTypes } from "@/features/library/hooks/useGraphFilterTypes";
import { BookmarksCollection } from "@/features/bookmarks/components/BookmarksCollection";
import { TagsCollection } from "@/features/tags/components/TagsCollection";
import { sanitizeLibraryTagFilterParams } from "@/features/tags/hooks/useTagFilterState";
import { LibrarySidebar, type LibraryTab } from "@/features/library/components/LibrarySidebar";

// Separate chunk: the graph pulls d3-force and never loads on the bookmarks/tags paths.
const KnowledgeGraph = lazyImport(
  () => import("@/features/library/components/KnowledgeGraph"),
  "KnowledgeGraph",
);

interface TabLinkProps {
  to: string;
  active: boolean;
  label: string;
  testId: string;
}

function TabLink({ to, active, label, testId }: TabLinkProps) {
  return (
    <Link
      to={to}
      aria-current={active ? "page" : undefined}
      className={cn(
        "group/tab flex items-center gap-2 rounded-md px-1 py-1 text-sm transition-colors",
        active ? "font-semibold text-foreground" : "text-muted-foreground hover:text-foreground",
      )}
      data-testid={testId}
    >
      <span
        className={cn(
          "bookmark-card-marker h-3.5 w-2 transition-colors",
          active ? "bg-primary" : "bg-muted-foreground/25 group-hover/tab:bg-muted-foreground/40",
        )}
        aria-hidden="true"
      />
      {label}
    </Link>
  );
}

const TAB_LABELS: Record<LibraryTab, string> = {
  saved: "Bookmarks",
  tags: "Tags",
  graph: "Knowledge Graph",
};

function LibraryHeader({ tab }: { tab: LibraryTab }) {
  const { isTabletOrDesktop } = useBreakpoint();

  if (isTabletOrDesktop) {
    return (
      <header className="mt-5">
        <h1 className="text-lg font-semibold tracking-tight text-foreground">{TAB_LABELS[tab]}</h1>
      </header>
    );
  }

  return (
    <header className="mt-5 flex flex-wrap items-center gap-x-6 gap-y-2">
      <h1 className="text-lg font-semibold tracking-tight text-foreground">Library</h1>
      <nav className="flex items-center gap-5" aria-label="Library sections">
        <TabLink
          to="/library"
          active={tab === "saved"}
          label="Bookmarks"
          testId="library-tab-saved"
        />
        <TabLink
          to="/library/tags"
          active={tab === "tags"}
          label="Tags"
          testId="library-tab-tags"
        />
        <TabLink
          to="/library/graph"
          active={tab === "graph"}
          label="Graph"
          testId="library-tab-graph"
        />
      </nav>
    </header>
  );
}

export function LibraryPage() {
  const isZenMode = useAppSelector((s) => s.zenMode.isActive);
  const { isTabletOrDesktop } = useBreakpoint();
  const graphTypes = useGraphFilterTypes();
  const { selected: graphSelectedTypes, setSelected: setGraphSelectedTypes } =
    useSavedTypesFilter();
  const location = useLocation();
  const tab: LibraryTab = location.pathname.startsWith("/library/tags")
    ? "tags"
    : location.pathname.startsWith("/library/graph")
      ? "graph"
      : "saved";
  const sanitizedTagParams = sanitizeLibraryTagFilterParams(
    new URLSearchParams(location.search),
  ).toString();
  const sanitizedTagSearch = sanitizedTagParams ? `?${sanitizedTagParams}` : "";

  if (tab === "tags" && sanitizedTagSearch !== location.search) {
    return (
      <Navigate
        to={{ pathname: location.pathname, search: sanitizedTagSearch, hash: location.hash }}
        replace
      />
    );
  }

  return (
    <>
      <AppHeader />
      <div
        className={cn(
          "relative flex overflow-hidden bg-background transition-[height] duration-300 ease-in-out",
          isZenMode ? "h-dvh delay-150" : "h-[calc(100dvh-3rem)] delay-0",
        )}
      >
        {isTabletOrDesktop && !isZenMode && (
          <aside className="w-60 shrink-0 border-r border-border bg-background">
            <LibrarySidebar tab={tab} />
          </aside>
        )}

        {tab === "graph" ? (
          <div className="flex min-w-0 flex-1 flex-col overflow-hidden bg-card">
            {!isTabletOrDesktop && (
              <div className="px-4 pb-2">
                <LibraryHeader tab="graph" />
                {graphTypes.length > 0 && (
                  <div className="mt-3">
                    <BookmarkTypeFilters
                      types={graphTypes}
                      selected={graphSelectedTypes}
                      onChange={setGraphSelectedTypes}
                    />
                  </div>
                )}
              </div>
            )}
            <div className="min-h-0 flex-1">
              <LazyRoute>
                <KnowledgeGraph />
              </LazyRoute>
            </div>
          </div>
        ) : (
          <div className="relative min-w-0 flex-1 overflow-y-auto bg-card">
            {/* Faded dot grid gives the library a pinboard texture without competing with content. */}
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-x-0 top-0 h-72 [background-image:radial-gradient(hsl(var(--foreground)/0.07)_1px,transparent_1px)] [background-size:18px_18px] [mask-image:linear-gradient(to_bottom,black,transparent)]"
            />
            <div className="relative mx-auto w-full max-w-6xl px-4 pb-12 sm:px-6 lg:px-8">
              {tab === "saved" ? (
                <BookmarksCollection header={<LibraryHeader tab="saved" />} />
              ) : (
                <TagsCollection header={<LibraryHeader tab="tags" />} />
              )}
            </div>
          </div>
        )}
      </div>
    </>
  );
}
