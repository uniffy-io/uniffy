import { describe, expect, it } from 'vitest';
import { layoutTree, type TreeLayoutNode } from '@/features/people/utils/treeLayout';

const OPTS = { nodeWidth: 100, nodeHeight: 50, hGap: 20, vGap: 30 };
const SLOT = OPTS.nodeWidth + OPTS.hGap;
const LEVEL = OPTS.nodeHeight + OPTS.vGap;

function n(id: string, parentId: string | null = null): TreeLayoutNode {
    return { id, parentId };
}

describe('layoutTree', () => {
    it('places a chain on consecutive levels with one x column', () => {
        const positions = layoutTree([n('a'), n('b', 'a'), n('c', 'b')], ['a'], OPTS);
        expect(positions.get('a')).toEqual({ x: 0, y: 0 });
        expect(positions.get('b')).toEqual({ x: 0, y: LEVEL });
        expect(positions.get('c')).toEqual({ x: 0, y: 2 * LEVEL });
    });

    it('centers a parent over its children', () => {
        const positions = layoutTree(
            [n('boss'), n('r1', 'boss'), n('r2', 'boss'), n('r3', 'boss')],
            ['boss'],
            OPTS,
        );
        expect(positions.get('r1')!.x).toBe(0);
        expect(positions.get('r2')!.x).toBe(SLOT);
        expect(positions.get('r3')!.x).toBe(2 * SLOT);
        expect(positions.get('boss')!.x).toBe(SLOT);
        expect(positions.get('boss')!.y).toBe(0);
    });

    it('keeps sibling subtrees from overlapping', () => {
        const positions = layoutTree(
            [
                n('root'),
                n('a', 'root'),
                n('a1', 'a'),
                n('a2', 'a'),
                n('b', 'root'),
                n('b1', 'b'),
            ],
            ['root'],
            OPTS,
        );
        const depthOne = [positions.get('a1')!, positions.get('a2')!, positions.get('b1')!];
        const xs = depthOne.map((p) => p.x).sort((x, y) => x - y);
        for (let i = 1; i < xs.length; i++) {
            expect(xs[i] - xs[i - 1]).toBeGreaterThanOrEqual(SLOT);
        }
        expect(positions.get('b')!.x).toBeGreaterThan(positions.get('a')!.x);
    });

    it('lays out multiple roots side by side without collisions', () => {
        const positions = layoutTree(
            [n('r1'), n('c1', 'r1'), n('r2'), n('c2', 'r2')],
            ['r1', 'r2'],
            OPTS,
        );
        expect(positions.get('r1')!.y).toBe(0);
        expect(positions.get('r2')!.y).toBe(0);
        expect(positions.get('c1')!.x).not.toBe(positions.get('c2')!.x);
    });

    it('roots a node whose parent id does not exist', () => {
        const positions = layoutTree([n('orphan', 'ghost')], [], OPTS);
        expect(positions.get('orphan')).toEqual({ x: 0, y: 0 });
    });

    it('ignores a self-parent edge', () => {
        const positions = layoutTree([n('loop', 'loop')], [], OPTS);
        expect(positions.get('loop')).toEqual({ x: 0, y: 0 });
    });

    it('terminates on a cycle and places every node', () => {
        const positions = layoutTree(
            [n('a', 'c'), n('b', 'a'), n('c', 'b'), n('solo')],
            ['solo'],
            OPTS,
        );
        expect(positions.size).toBe(4);
        const seen = new Set(
            [...positions.values()].map((p) => `${p.x}:${p.y}`),
        );
        expect(seen.size).toBe(4);
    });

    it('places every node exactly once on a larger org', () => {
        const nodes: TreeLayoutNode[] = [n('ceo')];
        for (let i = 0; i < 5; i++) {
            nodes.push(n(`m${i}`, 'ceo'));
            for (let j = 0; j < 4; j++) {
                nodes.push(n(`m${i}-r${j}`, `m${i}`));
            }
        }
        const positions = layoutTree(nodes, ['ceo'], OPTS);
        expect(positions.size).toBe(nodes.length);
        const leaves = nodes.filter((node) => node.id.includes('-r'));
        const leafXs = leaves.map((leaf) => positions.get(leaf.id)!.x).sort((a, b) => a - b);
        for (let i = 1; i < leafXs.length; i++) {
            expect(leafXs[i] - leafXs[i - 1]).toBeGreaterThanOrEqual(SLOT);
        }
    });
});
