import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import type { PDFDocumentProxy } from "pdfjs-dist";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { Spinner } from "@phosphor-icons/react";
import { useAppDispatch, useAppSelector } from "@/app/hooks";
import { useShortcutHandler } from "@/features/settings";
import {
  setPage,
  setPdfDocumentInfo,
  setPdfSidebarOpen,
  setPdfZoom,
  setTotalPages,
  setViewerLoading,
} from "@/features/files/store/viewerSlice";
import { useFileDownload } from "@/features/files/components/viewer/hooks/useFileDownload";
import { PdfSidebar } from "@/features/files/components/viewer/pdf/PdfSidebar";
import { PdfSearchBar } from "@/features/files/components/viewer/pdf/PdfSearchBar";
import { PdfWatermarkPreview } from "@/features/files/components/viewer/pdf/PdfWatermarkPreview";
import { PdfPasswordForm } from "@/features/files/components/viewer/pdf/PdfPasswordForm";
import { PdfSelectionPopover } from "@/features/files/components/viewer/pdf/PdfSelectionPopover";
import { usePdfSearch } from "@/features/files/components/viewer/pdf/usePdfSearch";
import { highlightTextItem } from "@/features/files/components/viewer/pdf/pdfSearch";
import { extractPdfDocumentInfo } from "@/features/files/components/viewer/pdf/pdfMetadata";
import {
  getReadingPosition,
  setReadingPosition,
} from "@/features/files/components/viewer/pdf/pdfReadingPosition";
import { buildMediaUrl } from "@/shared/utils/fileUrls";
import { useBreakpoint } from "@/shared/hooks/useBreakpoint";
import type { SerializedFile } from "@/features/files/store/filesThunks";

import "react-pdf/dist/esm/Page/AnnotationLayer.css";
import "react-pdf/dist/esm/Page/TextLayer.css";

pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

// Errors-only: silence per-font TrueType hinting warnings ("TT: undefined function")
// that pdf.js logs for malformed embedded font programs it already renders around.
const PDF_OPTIONS = { verbosity: pdfjs.VerbosityLevel.ERRORS } as const;

/** Above this size, load through the Range-capable media route instead of a full download. */
const RANGED_PDF_MIN_BYTES = 16 * 1024 * 1024;
/** Horizontal/vertical breathing room subtracted from the container when computing fit scales. */
const FIT_PADDING = 48;
/** The `auto` default renders at a fraction of fit-width so pages keep reading margins. */
const AUTO_FIT_FRACTION = 0.8;
const SPREAD_GAP = 16;
const SCROLL_SETTLE_MS = 150;
const FALLBACK_PAGE_HEIGHT = 400;
/** Canvases above 2x DPR cost 4x the memory for no visible gain. */
const DEVICE_PIXEL_RATIO_CAP = 2;
const ZOOM_RENDER_DEBOUNCE_MS = 200;
const READING_POSITION_DEBOUNCE_MS = 500;

type PasswordStatus = "none" | "required" | "incorrect";

interface PdfViewerProps {
  file: SerializedFile;
}

export function PdfViewer({ file }: PdfViewerProps) {
  // Remount per file so page refs, the mounted-row set, and base dims reset cleanly.
  return <PdfDocumentView key={file.id} file={file} />;
}

function PdfDocumentView({ file }: PdfViewerProps) {
  const dispatch = useAppDispatch();
  const currentPage = useAppSelector((state) => state.fileViewer.currentPage);
  const pdfZoom = useAppSelector((state) => state.fileViewer.pdfZoom);
  const pdfRotation = useAppSelector((state) => state.fileViewer.pdfRotation);
  const pdfFitMode = useAppSelector((state) => state.fileViewer.pdfFitMode);
  const pdfSidebarOpen = useAppSelector((state) => state.fileViewer.pdfSidebarOpen);
  const pdfInvert = useAppSelector((state) => state.fileViewer.pdfInvert);
  const pdfSpread = useAppSelector((state) => state.fileViewer.pdfSpread);
  const pdfPresentation = useAppSelector((state) => state.fileViewer.pdfPresentation);
  const pdfInitialPage = useAppSelector((state) => state.fileViewer.pdfInitialPage);
  const { isMobile, isDesktop } = useBreakpoint();

  const [error, setError] = useState<string | null>(null);
  const [rangedFailed, setRangedFailed] = useState(false);
  const [passwordStatus, setPasswordStatus] = useState<PasswordStatus>("none");
  const [pdfProxy, setPdfProxy] = useState<PDFDocumentProxy | null>(null);
  const [numPages, setNumPages] = useState(0);
  const [baseSize, setBaseSize] = useState<{ width: number; height: number } | null>(null);
  const [hasOutline, setHasOutline] = useState(false);
  const [mountedRows, setMountedRows] = useState<Set<number>>(() => new Set([1]));
  const [containerSize, setContainerSize] = useState<{ width: number; height: number } | null>(
    null,
  );
  /** Crisp canvas scale, debounced behind pdfZoom; the gap is bridged by a CSS transform. */
  const [renderScale, setRenderScale] = useState(1);

  const useRanged = file.sizeBytes >= RANGED_PDF_MIN_BYTES && !rangedFailed;
  const {
    blob: pdfBlob,
    loading: downloadLoading,
    error: downloadError,
  } = useFileDownload(file.id, { skip: useRanged });

  const rangedFile = useMemo(
    () => ({ url: buildMediaUrl(file.organizationId, file.id) }),
    [file.organizationId, file.id],
  );
  const rangedOptions = useMemo(
    () => ({
      ...PDF_OPTIONS,
      withCredentials: true,
      rangeChunkSize: 262144,
      disableAutoFetch: true,
    }),
    [],
  );

  const layoutRef = useRef<HTMLDivElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const rowElsRef = useRef(new Map<number, HTMLDivElement>());
  /** Last page the scroll spy reported; jump effect only scrolls when Redux diverges from it. */
  const spyPageRef = useRef(1);
  const programmaticScrollRef = useRef(false);
  const settleTimerRef = useRef<number | null>(null);
  const scrollRafRef = useRef<number | null>(null);
  const passwordCallbackRef = useRef<((password: string | null) => void) | null>(null);

  const spreadActive = pdfSpread && isDesktop && !pdfPresentation;

  /** Book layout: cover alone, then pairs. Rows are keyed by their first page. */
  const rows = useMemo(() => {
    const result: number[][] = [];
    if (numPages <= 0) return result;
    if (!spreadActive) {
      for (let page = 1; page <= numPages; page += 1) result.push([page]);
      return result;
    }
    result.push([1]);
    for (let page = 2; page <= numPages; page += 2) {
      result.push(page + 1 <= numPages ? [page, page + 1] : [page]);
    }
    return result;
  }, [numPages, spreadActive]);

  const rowFirstPageFor = useCallback(
    (page: number): number => {
      if (!spreadActive || page <= 1) return Math.max(page, 1);
      return page % 2 === 0 ? page : page - 1;
    },
    [spreadActive],
  );

  const registerRowEl = useCallback((firstPage: number, el: HTMLDivElement | null) => {
    if (el) {
      rowElsRef.current.set(firstPage, el);
    } else {
      rowElsRef.current.delete(firstPage);
    }
  }, []);

  const handleDocumentLoadSuccess = useCallback(
    (pdf: PDFDocumentProxy) => {
      dispatch(setTotalPages(pdf.numPages));
      dispatch(setViewerLoading(false));
      setPasswordStatus("none");
      setPdfProxy(pdf);
      setNumPages(pdf.numPages);

      // Jump priority: ?page= deep link > stored reading position > page 1.
      const storedPage = getReadingPosition(file.id);
      let targetPage = 1;
      if (pdfInitialPage !== null) {
        targetPage = Math.min(pdfInitialPage, pdf.numPages);
      } else if (storedPage !== null && storedPage <= pdf.numPages) {
        targetPage = storedPage;
      }
      if (targetPage > 1) {
        dispatch(setPage(targetPage));
      }

      // Page 1 dims size every placeholder; differently-sized pages self-correct on mount.
      void pdf.getPage(1).then((page) => {
        const viewport = page.getViewport({ scale: 1 });
        setBaseSize({ width: viewport.width, height: viewport.height });
      });
      void pdf.getOutline().then((outline) => setHasOutline(Boolean(outline?.length)));
      void pdf
        .getMetadata()
        .then(({ info }) => dispatch(setPdfDocumentInfo(extractPdfDocumentInfo(info))))
        .catch(() => {});
    },
    [dispatch, file.id, pdfInitialPage],
  );

  const handleDocumentLoadError = useCallback(() => {
    if (useRanged) {
      // Range route unavailable (transcode gate, proxy without Range support):
      // fall back to the full blob download.
      setRangedFailed(true);
      return;
    }
    setError("Failed to load PDF");
    dispatch(setViewerLoading(false));
  }, [useRanged, dispatch]);

  const handlePassword = useCallback(
    (callback: (password: string | null) => void, reason: number) => {
      passwordCallbackRef.current = callback;
      setPasswordStatus(
        reason === pdfjs.PasswordResponses.INCORRECT_PASSWORD ? "incorrect" : "required",
      );
    },
    [],
  );

  const handlePasswordSubmit = useCallback((password: string) => {
    passwordCallbackRef.current?.(password);
  }, []);

  const handlePasswordCancel = useCallback(() => {
    setPasswordStatus("none");
    setError("Password required");
    dispatch(setViewerLoading(false));
  }, [dispatch]);

  // Mount/unmount page canvases as their row wrappers approach the viewport.
  useEffect(() => {
    const container = containerRef.current;
    if (!container || numPages === 0 || pdfPresentation) return;
    const observer = new IntersectionObserver(
      (entries) => {
        setMountedRows((prev) => {
          let changed = false;
          const next = new Set(prev);
          for (const entry of entries) {
            const firstPage = Number((entry.target as HTMLElement).dataset.page);
            if (entry.isIntersecting && !next.has(firstPage)) {
              next.add(firstPage);
              changed = true;
            } else if (!entry.isIntersecting && next.has(firstPage)) {
              next.delete(firstPage);
              changed = true;
            }
          }
          return changed ? next : prev;
        });
      },
      { root: container, rootMargin: "150% 0px" },
    );
    for (const el of rowElsRef.current.values()) {
      observer.observe(el);
    }
    return () => observer.disconnect();
  }, [numPages, spreadActive, pdfPresentation]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || numPages === 0) return;
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0].contentRect;
      setContainerSize({ width: rect.width, height: rect.height });
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, [numPages, pdfPresentation]);

  const rotatedSize = useMemo(() => {
    if (!baseSize) return null;
    return pdfRotation % 180 === 0 ? baseSize : { width: baseSize.height, height: baseSize.width };
  }, [baseSize, pdfRotation]);

  useEffect(() => {
    if (pdfFitMode === "custom" || pdfPresentation || !rotatedSize || !containerSize) return;
    const contentWidth = spreadActive ? 2 * rotatedSize.width + SPREAD_GAP : rotatedSize.width;
    const fitWidth = (containerSize.width - FIT_PADDING) / contentWidth;
    let scale: number;
    if (pdfFitMode === "page") {
      scale = Math.min(fitWidth, (containerSize.height - FIT_PADDING) / rotatedSize.height);
    } else if (pdfFitMode === "auto") {
      scale = fitWidth * AUTO_FIT_FRACTION;
    } else {
      scale = fitWidth;
    }
    if (scale > 0) {
      dispatch(setPdfZoom(scale));
    }
  }, [pdfFitMode, pdfPresentation, spreadActive, rotatedSize, containerSize, dispatch]);

  // Wheel-tick zooms stretch the existing canvas via CSS; the crisp re-render lands on settle.
  useEffect(() => {
    if (renderScale === pdfZoom) return;
    const timer = window.setTimeout(() => setRenderScale(pdfZoom), ZOOM_RENDER_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [pdfZoom, renderScale]);

  // Persist the reading position so reopening the document resumes where the user left off.
  useEffect(() => {
    if (numPages <= 1) return;
    const timer = window.setTimeout(
      () => setReadingPosition(file.id, currentPage),
      READING_POSITION_DEBOUNCE_MS,
    );
    return () => window.clearTimeout(timer);
  }, [currentPage, numPages, file.id]);

  const handleScroll = useCallback(() => {
    if (programmaticScrollRef.current) {
      // Programmatic jump in flight: swallow spy updates until scrolling settles.
      if (settleTimerRef.current !== null) window.clearTimeout(settleTimerRef.current);
      settleTimerRef.current = window.setTimeout(() => {
        programmaticScrollRef.current = false;
      }, SCROLL_SETTLE_MS);
      return;
    }
    if (scrollRafRef.current !== null) return;
    scrollRafRef.current = window.requestAnimationFrame(() => {
      scrollRafRef.current = null;
      const container = containerRef.current;
      if (!container) return;
      const containerRect = container.getBoundingClientRect();
      let bestRow = rowFirstPageFor(spyPageRef.current);
      let bestVisible = 0;
      for (const [firstPage, el] of rowElsRef.current) {
        const rect = el.getBoundingClientRect();
        const visible =
          Math.min(rect.bottom, containerRect.bottom) - Math.max(rect.top, containerRect.top);
        if (visible > bestVisible) {
          bestVisible = visible;
          bestRow = firstPage;
        }
      }
      if (bestVisible > 0 && bestRow !== rowFirstPageFor(spyPageRef.current)) {
        spyPageRef.current = bestRow;
        dispatch(setPage(bestRow));
      }
    });
  }, [dispatch, rowFirstPageFor]);

  // The presentation branch swaps the scroll container out; force the jump effect
  // to restore the reading position when the scroll column comes back.
  useEffect(() => {
    if (!pdfPresentation) {
      spyPageRef.current = 1;
    }
  }, [pdfPresentation]);

  // External jumps (toolbar input, carets, sidebar, shortcuts) scroll to the target row.
  useEffect(() => {
    if (numPages === 0 || pdfPresentation || currentPage === spyPageRef.current) return;
    const sameRow = rowFirstPageFor(currentPage) === rowFirstPageFor(spyPageRef.current);
    spyPageRef.current = currentPage;
    if (sameRow) return;
    const container = containerRef.current;
    const target = rowElsRef.current.get(rowFirstPageFor(currentPage));
    if (!container || !target) return;
    programmaticScrollRef.current = true;
    const top =
      target.getBoundingClientRect().top -
      container.getBoundingClientRect().top +
      container.scrollTop;
    container.scrollTo({ top: Math.max(0, top - 16) });
    if (settleTimerRef.current !== null) window.clearTimeout(settleTimerRef.current);
    settleTimerRef.current = window.setTimeout(() => {
      programmaticScrollRef.current = false;
    }, SCROLL_SETTLE_MS);
  }, [currentPage, numPages, pdfPresentation, rowFirstPageFor]);

  useEffect(() => {
    return () => {
      if (settleTimerRef.current !== null) window.clearTimeout(settleTimerRef.current);
      if (scrollRafRef.current !== null) window.cancelAnimationFrame(scrollRafRef.current);
    };
  }, []);

  const handleJump = useCallback(
    (page: number) => {
      dispatch(setPage(page));
      if (isMobile) {
        dispatch(setPdfSidebarOpen(false));
      }
    },
    [dispatch, isMobile],
  );

  const handleSearchJump = useCallback(
    (page: number) => {
      dispatch(setPage(page));
    },
    [dispatch],
  );

  const handleSidebarClose = useCallback(() => {
    dispatch(setPdfSidebarOpen(false));
  }, [dispatch]);

  const search = usePdfSearch(pdfProxy, numPages, handleSearchJump);
  const { openSearch } = search;
  useShortcutHandler("viewer.search", openSearch);

  const activeQuery = search.open ? search.query.trim() : "";
  const customTextRenderer = useMemo(() => {
    if (!activeQuery) return undefined;
    return ({ str }: { str: string }) => highlightTextItem(str, activeQuery);
  }, [activeQuery]);

  if (!useRanged) {
    if (downloadLoading) {
      return (
        <div className="viewer-loading">
          <Spinner size={48} className="animate-spin" />
        </div>
      );
    }

    if (downloadError || !pdfBlob) {
      return (
        <div className="viewer-error">
          <p>{downloadError || "Unable to load PDF"}</p>
        </div>
      );
    }
  }

  if (error) {
    return (
      <div className="viewer-error">
        <p>{error}</p>
      </div>
    );
  }

  const devicePixelRatio = Math.min(window.devicePixelRatio || 1, DEVICE_PIXEL_RATIO_CAP);
  // Placeholders track the target zoom (true layout size) so the scrollbar never jumps
  // when the crisp canvas lands.
  const pageWidth = rotatedSize ? rotatedSize.width * pdfZoom : undefined;
  const pageHeight = rotatedSize ? rotatedSize.height * pdfZoom : FALLBACK_PAGE_HEIGHT;
  const interimScale = renderScale > 0 ? pdfZoom / renderScale : 1;
  const presentationScale =
    rotatedSize && containerSize
      ? Math.max(
          0.1,
          Math.min(
            (containerSize.width - FIT_PADDING) / rotatedSize.width,
            (containerSize.height - FIT_PADDING) / rotatedSize.height,
          ),
        )
      : 1;

  const renderPage = (pageNumber: number) => (
    <div
      key={pageNumber}
      className="relative"
      style={
        interimScale !== 1
          ? { transform: `scale(${interimScale})`, transformOrigin: "top center" }
          : undefined
      }
    >
      <Page
        pageNumber={pageNumber}
        scale={renderScale}
        rotate={pdfRotation}
        devicePixelRatio={devicePixelRatio}
        customTextRenderer={customTextRenderer}
        className="shadow-2xl rounded-sm"
        loading={
          <div
            className="viewer-pdf-page-placeholder"
            style={{ height: pageHeight, width: pageWidth }}
          />
        }
      />
      <PdfWatermarkPreview pageWidth={rotatedSize ? rotatedSize.width * renderScale : undefined} />
    </div>
  );

  return (
    <Document
      inputRef={layoutRef}
      file={useRanged ? rangedFile : pdfBlob}
      options={useRanged ? rangedOptions : PDF_OPTIONS}
      className="viewer-pdf-layout"
      onLoadSuccess={handleDocumentLoadSuccess}
      onLoadError={handleDocumentLoadError}
      onPassword={handlePassword}
      loading={
        passwordStatus === "none" ? (
          <div className="viewer-loading">
            <Spinner size={32} className="animate-spin" />
          </div>
        ) : (
          <PdfPasswordForm
            incorrect={passwordStatus === "incorrect"}
            onSubmit={handlePasswordSubmit}
            onCancel={handlePasswordCancel}
          />
        )
      }
    >
      {pdfPresentation ? (
        <div
          ref={containerRef}
          className={`viewer-pdf-presentation ${pdfInvert ? "viewer-pdf-night" : ""}`}
        >
          <Page
            pageNumber={currentPage}
            scale={presentationScale}
            rotate={pdfRotation}
            devicePixelRatio={devicePixelRatio}
            className="shadow-2xl rounded-sm"
            loading={<Spinner size={32} className="animate-spin" />}
          />
        </div>
      ) : (
        <>
          {pdfSidebarOpen && (
            <PdfSidebar
              numPages={numPages}
              currentPage={currentPage}
              hasOutline={hasOutline}
              thumbAspect={rotatedSize ? rotatedSize.height / rotatedSize.width : 1.4}
              devicePixelRatio={devicePixelRatio}
              isDrawer={isMobile}
              onJump={handleJump}
              onClose={handleSidebarClose}
            />
          )}
          <div ref={containerRef} className="viewer-pdf-content" onScroll={handleScroll}>
            <div className={`viewer-pdf-pages ${pdfInvert ? "viewer-pdf-night" : ""}`}>
              {rows.map((rowPages) => {
                const firstPage = rowPages[0];
                const rowWidth =
                  pageWidth !== undefined
                    ? rowPages.length * pageWidth + (rowPages.length - 1) * SPREAD_GAP
                    : undefined;
                return (
                  <div
                    key={firstPage}
                    data-page={firstPage}
                    ref={(el) => registerRowEl(firstPage, el)}
                    className="viewer-pdf-page"
                    style={{ minHeight: pageHeight, width: rowWidth }}
                  >
                    {mountedRows.has(firstPage) ? (
                      <div className="viewer-pdf-row">
                        {rowPages.map((pageNumber) => renderPage(pageNumber))}
                      </div>
                    ) : (
                      <div
                        className="viewer-pdf-page-placeholder"
                        style={{ height: pageHeight, width: rowWidth }}
                      />
                    )}
                  </div>
                );
              })}
            </div>
          </div>
          <PdfSelectionPopover
            layoutRef={layoutRef}
            containerRef={containerRef}
            filename={file.filename}
            fileId={file.id}
          />
        </>
      )}
      {search.open && !pdfPresentation && (
        <PdfSearchBar
          query={search.query}
          activeOrdinal={search.activeOrdinal}
          totalMatches={search.totalMatches}
          searching={search.searching}
          onQueryChange={search.setQuery}
          onNext={search.next}
          onPrev={search.prev}
          onClose={search.closeSearch}
        />
      )}
    </Document>
  );
}
