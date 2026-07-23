import { describe, it, expect } from 'vitest';
import {
    initPageOps,
    rotatePages,
    deletePages,
    movePage,
    extractPages,
} from '../pdfPageOps';

describe('pdfPageOps', () => {
    it('initPageOps builds identity ops', () => {
        expect(initPageOps(3)).toEqual([
            { originalIndex: 0, rotation: 0 },
            { originalIndex: 1, rotation: 0 },
            { originalIndex: 2, rotation: 0 },
        ]);
        expect(initPageOps(0)).toEqual([]);
    });

    it('rotatePages accumulates mod 360 in both directions', () => {
        let state = initPageOps(2);
        state = rotatePages(state, [0], 1);
        expect(state[0].rotation).toBe(90);
        state = rotatePages(state, [0], 1);
        state = rotatePages(state, [0], 1);
        state = rotatePages(state, [0], 1);
        expect(state[0].rotation).toBe(0);
        state = rotatePages(state, [0], -1);
        expect(state[0].rotation).toBe(270);
        expect(state[1].rotation).toBe(0);
    });

    it('deletePages keeps order and original indices', () => {
        const state = deletePages(initPageOps(4), [1, 3]);
        expect(state.map((op) => op.originalIndex)).toEqual([0, 2]);
    });

    it('movePage reorders and clamps out-of-range positions', () => {
        const moved = movePage(initPageOps(4), 0, 2);
        expect(moved.map((op) => op.originalIndex)).toEqual([1, 2, 0, 3]);

        const clamped = movePage(initPageOps(3), -5, 99);
        expect(clamped.map((op) => op.originalIndex)).toEqual([1, 2, 0]);

        expect(movePage([], 0, 1)).toEqual([]);
    });

    it('extractPages preserves selection order and rotations', () => {
        const rotated = rotatePages(initPageOps(4), [2], 1);
        const extracted = extractPages(rotated, [2, 0]);
        expect(extracted).toEqual([
            { originalIndex: 0, rotation: 0 },
            { originalIndex: 2, rotation: 90 },
        ]);
    });

    it('ops compose: rotate then delete then move', () => {
        let state = initPageOps(5);
        state = rotatePages(state, [1, 3], 1);
        state = deletePages(state, [0]);
        state = movePage(state, 0, 2);
        expect(state).toEqual([
            { originalIndex: 2, rotation: 0 },
            { originalIndex: 3, rotation: 90 },
            { originalIndex: 1, rotation: 90 },
            { originalIndex: 4, rotation: 0 },
        ]);
    });

    it('operations never mutate their input', () => {
        const state = initPageOps(3);
        rotatePages(state, [0], 1);
        deletePages(state, [0]);
        movePage(state, 0, 2);
        extractPages(state, [1]);
        expect(state).toEqual(initPageOps(3));
    });
});
