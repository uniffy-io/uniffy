import { useEffect, useRef, useState } from "react";
import { Outline, Thumbnail } from "react-pdf";

const THUMB_WIDTH = 120;

interface PdfSidebarProps {
  numPages: number;
  currentPage: number;
  hasOutline: boolean;
  /** Rotated page height / width; sizes thumbnail placeholders before render. */
  thumbAspect: number;
  devicePixelRatio: number;
  isDrawer: boolean;
  onJump: (page: number) => void;
  onClose: () => void;
}

export function PdfSidebar({
  numPages,
  currentPage,
  hasOutline,
  thumbAspect,
  devicePixelRatio,
  isDrawer,
  onJump,
  onClose,
}: PdfSidebarProps) {
  const [tab, setTab] = useState<"pages" | "outline">("pages");
  const listRef = useRef<HTMLDivElement | null>(null);
  const itemElsRef = useRef(new Map<number, HTMLDivElement>());
  const [visibleThumbs, setVisibleThumbs] = useState<Set<number>>(() => new Set());

  const activeTab = hasOutline ? tab : "pages";

  // Thumbnails are canvas renders; only mount the ones near the rail viewport.
  useEffect(() => {
    if (activeTab !== "pages") return;
    const root = listRef.current;
    if (!root || numPages === 0) return;
    const observer = new IntersectionObserver(
      (entries) => {
        setVisibleThumbs((prev) => {
          let changed = false;
          const next = new Set(prev);
          for (const entry of entries) {
            const page = Number((entry.target as HTMLElement).dataset.thumbPage);
            if (entry.isIntersecting && !next.has(page)) {
              next.add(page);
              changed = true;
            } else if (!entry.isIntersecting && next.has(page)) {
              next.delete(page);
              changed = true;
            }
          }
          return changed ? next : prev;
        });
      },
      { root, rootMargin: "300px 0px" },
    );
    for (const el of itemElsRef.current.values()) {
      observer.observe(el);
    }
    return () => observer.disconnect();
  }, [numPages, activeTab]);

  useEffect(() => {
    if (activeTab !== "pages") return;
    itemElsRef.current.get(currentPage)?.scrollIntoView({ block: "nearest" });
  }, [currentPage, activeTab]);

  const thumbHeight = Math.round(THUMB_WIDTH * thumbAspect);

  const rail = (
    <aside className={`viewer-pdf-sidebar ${isDrawer ? "viewer-pdf-sidebar-drawer" : ""}`}>
      {hasOutline && (
        <div className="viewer-pdf-tabs">
          <button
            type="button"
            className={`viewer-pdf-tab ${activeTab === "pages" ? "viewer-pdf-tab-active" : ""}`}
            onClick={() => setTab("pages")}
          >
            Pages
          </button>
          <button
            type="button"
            className={`viewer-pdf-tab ${activeTab === "outline" ? "viewer-pdf-tab-active" : ""}`}
            onClick={() => setTab("outline")}
          >
            Outline
          </button>
        </div>
      )}
      {activeTab === "pages" ? (
        <div ref={listRef} className="viewer-pdf-thumbs">
          {Array.from({ length: numPages }, (_, index) => {
            const page = index + 1;
            return (
              <div
                key={page}
                data-thumb-page={page}
                ref={(el) => {
                  if (el) {
                    itemElsRef.current.set(page, el);
                  } else {
                    itemElsRef.current.delete(page);
                  }
                }}
              >
                <div
                  className={`viewer-pdf-thumb ${page === currentPage ? "viewer-pdf-thumb-active" : ""}`}
                >
                  {visibleThumbs.has(page) ? (
                    <Thumbnail
                      pageNumber={page}
                      width={THUMB_WIDTH}
                      devicePixelRatio={devicePixelRatio}
                      onItemClick={({ pageNumber }) => onJump(pageNumber)}
                      loading={
                        <div
                          className="viewer-pdf-thumb-placeholder"
                          style={{ height: thumbHeight }}
                        />
                      }
                    />
                  ) : (
                    <button
                      type="button"
                      aria-label={`Page ${page}`}
                      className="viewer-pdf-thumb-placeholder"
                      style={{ height: thumbHeight }}
                      onClick={() => onJump(page)}
                    />
                  )}
                </div>
                <p className="viewer-pdf-thumb-label">{page}</p>
              </div>
            );
          })}
        </div>
      ) : (
        <Outline
          className="viewer-pdf-outline"
          onItemClick={({ pageNumber }) => onJump(pageNumber)}
        />
      )}
    </aside>
  );

  if (!isDrawer) {
    return rail;
  }

  return (
    <>
      <button
        type="button"
        aria-label="Close sidebar"
        className="viewer-pdf-drawer-backdrop"
        onClick={onClose}
      />
      {rail}
    </>
  );
}
