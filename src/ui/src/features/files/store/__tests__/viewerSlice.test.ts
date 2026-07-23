import { describe, it, expect } from 'vitest';
import {
    viewerReducer,
    openViewer,
    nextFile,
    previousFile,
    setPage,
    setTotalPages,
    setPdfZoom,
    setPdfRotation,
    setPdfFitMode,
    togglePdfSidebar,
    setPdfSidebarOpen,
    togglePdfInvert,
    togglePdfSpread,
    togglePdfPresentation,
    setPdfPresentation,
    setPdfDocumentInfo,
    setPdfWatermark,
} from '../viewerSlice';

type ViewerState = ReturnType<typeof viewerReducer>;

function openedState(overrides: Partial<ViewerState> = {}): ViewerState {
    const state = viewerReducer(
        undefined,
        openViewer({ fileId: 'a', playlist: ['a', 'b', 'c'] })
    );
    return { ...state, ...overrides };
}

describe('viewerSlice PDF state', () => {
    it('openViewer resets pdf zoom, rotation, and fit mode', () => {
        const dirty = openedState({
            pdfZoom: 2,
            pdfRotation: 180,
            pdfFitMode: 'custom',
        });
        const state = viewerReducer(dirty, openViewer({ fileId: 'b', playlist: ['a', 'b'] }));
        expect(state.pdfZoom).toBe(1);
        expect(state.pdfRotation).toBe(0);
        expect(state.pdfFitMode).toBe('auto');
    });

    it('nextFile resets pdf zoom, rotation, fit mode, and pages', () => {
        const dirty = openedState({
            pdfZoom: 2.5,
            pdfRotation: 90,
            pdfFitMode: 'custom',
            currentPage: 7,
            totalPages: 12,
        });
        const state = viewerReducer(dirty, nextFile());
        expect(state.currentFileId).toBe('b');
        expect(state.pdfZoom).toBe(1);
        expect(state.pdfRotation).toBe(0);
        expect(state.pdfFitMode).toBe('auto');
        expect(state.currentPage).toBe(1);
        expect(state.totalPages).toBe(0);
    });

    it('previousFile resets pdf zoom, rotation, and fit mode', () => {
        const atSecond = viewerReducer(
            openedState({ pdfZoom: 3, pdfRotation: 270, pdfFitMode: 'page' }),
            nextFile()
        );
        const dirty = { ...atSecond, pdfZoom: 3, pdfRotation: 270, pdfFitMode: 'page' as const };
        const state = viewerReducer(dirty, previousFile());
        expect(state.currentFileId).toBe('a');
        expect(state.pdfZoom).toBe(1);
        expect(state.pdfRotation).toBe(0);
        expect(state.pdfFitMode).toBe('auto');
    });

    it('keeps pdfSidebarOpen across file switches and reopen', () => {
        expect(openedState().pdfSidebarOpen).toBe(true);

        const withoutSidebar = viewerReducer(openedState(), togglePdfSidebar());
        expect(withoutSidebar.pdfSidebarOpen).toBe(false);

        const afterNext = viewerReducer(withoutSidebar, nextFile());
        expect(afterNext.pdfSidebarOpen).toBe(false);

        const reopened = viewerReducer(afterNext, openViewer({ fileId: 'c' }));
        expect(reopened.pdfSidebarOpen).toBe(false);
    });

    it('setPdfSidebarOpen sets an explicit value', () => {
        const open = viewerReducer(openedState(), setPdfSidebarOpen(true));
        expect(open.pdfSidebarOpen).toBe(true);
        const closed = viewerReducer(open, setPdfSidebarOpen(false));
        expect(closed.pdfSidebarOpen).toBe(false);
    });

    it('setPdfFitMode switches between the fit modes', () => {
        let state = openedState();
        expect(state.pdfFitMode).toBe('auto');
        state = viewerReducer(state, setPdfFitMode('width'));
        expect(state.pdfFitMode).toBe('width');
        state = viewerReducer(state, setPdfFitMode('page'));
        expect(state.pdfFitMode).toBe('page');
        state = viewerReducer(state, setPdfFitMode('custom'));
        expect(state.pdfFitMode).toBe('custom');
    });

    it('setPage clamps to the 1..totalPages range', () => {
        let state = viewerReducer(openedState(), setTotalPages(10));
        state = viewerReducer(state, setPage(0));
        expect(state.currentPage).toBe(1);
        state = viewerReducer(state, setPage(11));
        expect(state.currentPage).toBe(1);
        state = viewerReducer(state, setPage(10));
        expect(state.currentPage).toBe(10);
    });

    it('setPdfZoom clamps to the 0.25..4 range', () => {
        let state = viewerReducer(openedState(), setPdfZoom(0.01));
        expect(state.pdfZoom).toBe(0.25);
        state = viewerReducer(state, setPdfZoom(9));
        expect(state.pdfZoom).toBe(4);
    });

    it('setPdfRotation wraps at 360', () => {
        const state = viewerReducer(openedState(), setPdfRotation(450));
        expect(state.pdfRotation).toBe(90);
    });

    it('keeps pdfInvert and pdfSpread sticky across openViewer and nextFile', () => {
        let state = viewerReducer(openedState(), togglePdfInvert());
        state = viewerReducer(state, togglePdfSpread());
        expect(state.pdfInvert).toBe(true);
        expect(state.pdfSpread).toBe(true);

        state = viewerReducer(state, nextFile());
        expect(state.pdfInvert).toBe(true);
        expect(state.pdfSpread).toBe(true);

        state = viewerReducer(state, openViewer({ fileId: 'c' }));
        expect(state.pdfInvert).toBe(true);
        expect(state.pdfSpread).toBe(true);
    });

    it('resets pdfPresentation on openViewer but keeps it across nextFile', () => {
        let state = viewerReducer(openedState(), togglePdfPresentation());
        expect(state.pdfPresentation).toBe(true);

        state = viewerReducer(state, nextFile());
        expect(state.pdfPresentation).toBe(true);

        state = viewerReducer(state, openViewer({ fileId: 'c' }));
        expect(state.pdfPresentation).toBe(false);

        state = viewerReducer(state, setPdfPresentation(true));
        expect(state.pdfPresentation).toBe(true);
    });

    it('stores initialPage from openViewer and clears it on file switch', () => {
        let state = viewerReducer(
            undefined,
            openViewer({ fileId: 'a', playlist: ['a', 'b'], initialPage: 9 })
        );
        expect(state.pdfInitialPage).toBe(9);

        state = viewerReducer(state, nextFile());
        expect(state.pdfInitialPage).toBeNull();

        state = viewerReducer(state, openViewer({ fileId: 'a' }));
        expect(state.pdfInitialPage).toBeNull();

        state = viewerReducer(state, openViewer({ fileId: 'a', initialPage: 0 }));
        expect(state.pdfInitialPage).toBeNull();
    });

    it('sets and clears the watermark, resetting on file switches', () => {
        let state = viewerReducer(
            openedState(),
            setPdfWatermark({ text: 'DRAFT', opacity: 0.3 })
        );
        expect(state.pdfWatermark).toEqual({ text: 'DRAFT', opacity: 0.3 });

        state = viewerReducer(state, setPdfWatermark(null));
        expect(state.pdfWatermark).toBeNull();

        state = viewerReducer(state, setPdfWatermark({ text: 'X', opacity: 0.2 }));
        state = viewerReducer(state, nextFile());
        expect(state.pdfWatermark).toBeNull();

        state = viewerReducer(
            viewerReducer(state, setPdfWatermark({ text: 'X', opacity: 0.2 })),
            openViewer({ fileId: 'c' })
        );
        expect(state.pdfWatermark).toBeNull();
    });

    it('clears pdfDocumentInfo on openViewer and file switches', () => {
        let state = viewerReducer(
            openedState(),
            setPdfDocumentInfo({ title: 'Doc', author: 'A' })
        );
        expect(state.pdfDocumentInfo?.title).toBe('Doc');

        state = viewerReducer(state, nextFile());
        expect(state.pdfDocumentInfo).toBeNull();

        state = viewerReducer(
            viewerReducer(state, setPdfDocumentInfo({ title: 'Doc' })),
            openViewer({ fileId: 'b' })
        );
        expect(state.pdfDocumentInfo).toBeNull();
    });
});
