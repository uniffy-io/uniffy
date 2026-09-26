import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { View, ScrollView } from "react-native";
import type { LayoutChangeEvent, NativeScrollEvent, NativeSyntheticEvent } from "react-native";
import { Gesture } from "react-native-gesture-handler";
import { runOnJS, useAnimatedStyle, useSharedValue } from "react-native-reanimated";
import * as Haptics from "expo-haptics";

/**
 * How long the finger has to rest on a card before it lifts. Long enough that a
 * flick still scrolls the list, short enough that the pick-up feels immediate.
 */
const LIFT_DELAY_MS = 220;
const AUTOSCROLL_EDGE = 72;
const AUTOSCROLL_STEP = 14;
const AUTOSCROLL_INTERVAL_MS = 16;

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A drop column and the ids it currently renders, top to bottom. */
export interface DragColumn {
  columnKey: string;
  taskIds: string[];
}

export interface DropTarget {
  columnKey: string;
  /**
   * A slot in `taskIds` - which still contains the lifted task - so it runs
   * from 0 to `taskIds.length`.
   */
  index: number;
}

function sameTarget(a: DropTarget | null, b: DropTarget | null): boolean {
  if (!a || !b) return a === b;
  return a.columnKey === b.columnKey && a.index === b.index;
}

/**
 * Picks a task card up on a long press and tracks where it would land.
 *
 * Positions are held in the scroll content's own coordinate space: a group
 * registers its offset within the content and each card registers its offset
 * within its group, so nothing has to be re-measured while the finger moves.
 * Only the container's window origin is measured, once per layout.
 */
export function useTaskDrag(params: {
  enabled: boolean;
  /** Which way the columns are laid out, and so which axis picks the drop column. */
  axis: "vertical" | "horizontal";
  /** Spacing between two cards, which the gap that opens has to account for. */
  itemGap: number;
  columns: DragColumn[];
  onDrop: (taskId: string, target: DropTarget) => void;
}) {
  const { enabled, axis, itemGap } = params;

  const containerRef = useRef<View>(null);
  const verticalRef = useRef<ScrollView>(null);
  const horizontalRef = useRef<ScrollView>(null);

  const groupRects = useRef(new Map<string, Rect>());
  const listRects = useRef(new Map<string, Rect>());
  const itemRects = useRef(new Map<string, { columnKey: string; rect: Rect }>());
  const origin = useRef({ x: 0, y: 0 });
  const viewport = useRef({ width: 0, height: 0 });
  const content = useRef({ width: 0, height: 0 });
  const scroll = useRef({ x: 0, y: 0 });
  const finger = useRef({ x: 0, y: 0 });
  const autoScrollTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const columnsRef = useRef(params.columns);
  const onDropRef = useRef(params.onDrop);
  useEffect(() => {
    columnsRef.current = params.columns;
    onDropRef.current = params.onDrop;
  });

  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);
  const draggingRef = useRef<string | null>(null);
  const dropTargetRef = useRef<DropTarget | null>(null);

  // Only the finger position rides a shared value, and only the gesture's own
  // worklets write it. Everything the preview needs besides that is settled
  // once at pick-up on the JS side, where the layout registry lives.
  const previewX = useSharedValue(0);
  const previewY = useSharedValue(0);
  // Settled once at pick-up: the card's own size cannot change while it is in
  // the air, so the gap the list opens is sized from here rather than from the
  // measurement registry, which only the layout callbacks may read.
  const [lift, setLift] = useState<{
    grabX: number;
    grabY: number;
    width: number;
    height: number;
  } | null>(null);
  const [containerOrigin, setContainerOrigin] = useState({ x: 0, y: 0 });

  // A view switch relays everything from scratch; stale rects would otherwise
  // answer hit tests for cards that are no longer on screen.
  useEffect(() => {
    groupRects.current.clear();
    listRects.current.clear();
    itemRects.current.clear();
  }, [axis]);

  const measureOrigin = useCallback(() => {
    containerRef.current?.measureInWindow((x, y) => {
      origin.current = { x, y };
      setContainerOrigin({ x, y });
    });
  }, []);

  const registerGroup = useCallback((columnKey: string, event: LayoutChangeEvent) => {
    groupRects.current.set(columnKey, { ...event.nativeEvent.layout });
  }, []);

  const registerList = useCallback((columnKey: string, event: LayoutChangeEvent) => {
    listRects.current.set(columnKey, { ...event.nativeEvent.layout });
  }, []);

  const registerItem = useCallback(
    (columnKey: string, taskId: string, event: LayoutChangeEvent) => {
      itemRects.current.set(taskId, { columnKey, rect: { ...event.nativeEvent.layout } });
    },
    [],
  );

  // A group that stops rendering - a status filtered away by a search, a row
  // that scrolls out of a windowed list - keeps its last rect otherwise, and a
  // hit test happily lands a card in a column that is no longer on screen.
  const unregisterGroup = useCallback((columnKey: string) => {
    groupRects.current.delete(columnKey);
  }, []);

  const unregisterList = useCallback((columnKey: string) => {
    listRects.current.delete(columnKey);
  }, []);

  const unregisterItem = useCallback((taskId: string) => {
    itemRects.current.delete(taskId);
  }, []);

  const contentRectFor = useCallback((taskId: string): Rect | null => {
    const item = itemRects.current.get(taskId);
    if (!item) return null;
    const group = groupRects.current.get(item.columnKey);
    const list = listRects.current.get(item.columnKey);
    if (!group || !list) return null;
    return {
      x: group.x + list.x + item.rect.x,
      y: group.y + list.y + item.rect.y,
      width: item.rect.width,
      height: item.rect.height,
    };
  }, []);

  const hitTest = useCallback(
    (absX: number, absY: number): DropTarget | null => {
      const columns = columnsRef.current;
      if (columns.length === 0) return null;

      const x = absX - origin.current.x + scroll.current.x;
      const y = absY - origin.current.y + scroll.current.y;
      const along = axis === "horizontal" ? x : y;

      let columnKey: string | null = null;
      let nearest: { columnKey: string; distance: number } | null = null;
      for (const column of columns) {
        const rect = groupRects.current.get(column.columnKey);
        if (!rect) continue;
        const start = axis === "horizontal" ? rect.x : rect.y;
        const size = axis === "horizontal" ? rect.width : rect.height;
        if (along >= start && along <= start + size) {
          columnKey = column.columnKey;
          break;
        }
        // Dragging into the gap between two columns, or past the last one,
        // should still resolve rather than drop the card back where it was.
        const distance = Math.abs(along - (start + size / 2));
        if (!nearest || distance < nearest.distance) {
          nearest = { columnKey: column.columnKey, distance };
        }
      }
      if (!columnKey) columnKey = nearest?.columnKey ?? null;
      if (!columnKey) return null;

      const taskIds = columns.find((c) => c.columnKey === columnKey)?.taskIds ?? [];
      let index = taskIds.length;
      for (let i = 0; i < taskIds.length; i += 1) {
        const rect = contentRectFor(taskIds[i]);
        if (!rect) continue;
        if (y < rect.y + rect.height / 2) {
          index = i;
          break;
        }
      }

      return { columnKey, index };
    },
    [axis, contentRectFor],
  );

  const applyTarget = useCallback((next: DropTarget | null) => {
    const previous = dropTargetRef.current;
    if (sameTarget(previous, next)) return;
    // One tick when the card crosses into another column - reordering inside a
    // column fires on every row and turns into a buzz.
    if (next && previous && next.columnKey !== previous.columnKey) {
      Haptics.selectionAsync().catch(() => {});
    }
    dropTargetRef.current = next;
    setDropTarget(next);
  }, []);

  const stepAutoScroll = useCallback(() => {
    const { x: fx, y: fy } = finger.current;
    const left = origin.current.x;
    const top = origin.current.y;
    const right = left + viewport.current.width;
    const bottom = top + viewport.current.height;

    let scrolled = false;

    if (horizontalRef.current && viewport.current.width > 0) {
      const max = Math.max(0, content.current.width - viewport.current.width);
      let next = scroll.current.x;
      if (fx < left + AUTOSCROLL_EDGE) next = Math.max(0, next - AUTOSCROLL_STEP);
      else if (fx > right - AUTOSCROLL_EDGE) next = Math.min(max, next + AUTOSCROLL_STEP);
      if (next !== scroll.current.x) {
        scroll.current.x = next;
        horizontalRef.current.scrollTo({ x: next, animated: false });
        scrolled = true;
      }
    }

    if (verticalRef.current && viewport.current.height > 0) {
      const max = Math.max(0, content.current.height - viewport.current.height);
      let next = scroll.current.y;
      if (fy < top + AUTOSCROLL_EDGE) next = Math.max(0, next - AUTOSCROLL_STEP);
      else if (fy > bottom - AUTOSCROLL_EDGE) next = Math.min(max, next + AUTOSCROLL_STEP);
      if (next !== scroll.current.y) {
        scroll.current.y = next;
        verticalRef.current.scrollTo({ y: next, animated: false });
        scrolled = true;
      }
    }

    // The content moved under a stationary finger, so the drop slot changed.
    if (scrolled) applyTarget(hitTest(fx, fy));
  }, [applyTarget, hitTest]);

  const stopAutoScroll = useCallback(() => {
    if (autoScrollTimer.current === null) return;
    clearInterval(autoScrollTimer.current);
    autoScrollTimer.current = null;
  }, []);

  const begin = useCallback(
    (taskId: string, absX: number, absY: number) => {
      const rect = contentRectFor(taskId);
      if (!rect) return;

      setLift({
        grabX: absX - (origin.current.x + rect.x - scroll.current.x),
        grabY: absY - (origin.current.y + rect.y - scroll.current.y),
        width: rect.width,
        height: rect.height,
      });

      finger.current = { x: absX, y: absY };
      draggingRef.current = taskId;
      setDraggingId(taskId);
      dropTargetRef.current = null;
      applyTarget(hitTest(absX, absY));
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});

      stopAutoScroll();
      autoScrollTimer.current = setInterval(stepAutoScroll, AUTOSCROLL_INTERVAL_MS);
    },
    [applyTarget, contentRectFor, hitTest, stepAutoScroll, stopAutoScroll],
  );

  const move = useCallback(
    (absX: number, absY: number) => {
      if (!draggingRef.current) return;
      finger.current = { x: absX, y: absY };
      applyTarget(hitTest(absX, absY));
    },
    [applyTarget, hitTest],
  );

  const finish = useCallback(
    (commit: boolean) => {
      const taskId = draggingRef.current;
      const target = dropTargetRef.current;
      if (!taskId) return;

      stopAutoScroll();
      draggingRef.current = null;
      dropTargetRef.current = null;
      setDraggingId(null);
      setDropTarget(null);
      if (commit && target) onDropRef.current(taskId, target);
    },
    [stopAutoScroll],
  );

  useEffect(() => stopAutoScroll, [stopAutoScroll]);

  const buildGesture = useCallback(
    (taskId: string) =>
      Gesture.Pan()
        .enabled(enabled)
        .activateAfterLongPress(LIFT_DELAY_MS)
        .onStart((event) => {
          previewX.value = event.absoluteX;
          previewY.value = event.absoluteY;
          runOnJS(begin)(taskId, event.absoluteX, event.absoluteY);
        })
        .onUpdate((event) => {
          previewX.value = event.absoluteX;
          previewY.value = event.absoluteY;
          runOnJS(move)(event.absoluteX, event.absoluteY);
        })
        // A gesture that goes to FAILED or CANCELLED still ends, and reports it
        // through `success`. Committing on every end would write a move the
        // finger never released on - an incoming call mid-drag is enough.
        .onEnd((_event, success) => {
          runOnJS(finish)(success);
        })
        // Also runs when the gesture is interrupted, so a cancelled drag can
        // never leave a card stranded under the finger.
        .onFinalize(() => {
          runOnJS(finish)(false);
        }),
    [begin, enabled, finish, move, previewX, previewY],
  );

  // Handing a detector a freshly built gesture mid-drag re-attaches it and the
  // drag dies, and the target changes on every row the finger crosses. The
  // gestures are therefore built once per task list rather than per render.
  const gestures = useMemo(() => {
    const built = new Map<string, ReturnType<typeof Gesture.Pan>>();
    for (const column of params.columns) {
      // Building a Pan only stores its callbacks; nothing here reads the layout
      // refs those callbacks close over until a finger is actually down.
      // eslint-disable-next-line react/react-compiler
      for (const taskId of column.taskIds) built.set(taskId, buildGesture(taskId));
    }
    return built;
  }, [buildGesture, params.columns]);

  // Gesture.* is gesture-handler's builder namespace, not a component factory.
  // eslint-disable-next-line react/react-compiler
  const idleGesture = useMemo(() => Gesture.Pan().enabled(false), []);

  const gestureFor = useCallback(
    (taskId: string) => gestures.get(taskId) ?? idleGesture,
    [gestures, idleGesture],
  );

  /**
   * Everything the surrounding cards need to open a gap: how tall the lifted
   * card's slot is, and which slot it left and which it would take.
   */
  const shift = useMemo(() => {
    if (!draggingId || !dropTarget) return null;
    const sourceColumn = params.columns.findIndex((c) => c.taskIds.includes(draggingId));
    const destColumn = params.columns.findIndex((c) => c.columnKey === dropTarget.columnKey);
    if (sourceColumn < 0 || destColumn < 0) return null;
    const height = (lift?.height ?? 0) + itemGap;
    return {
      height,
      sourceColumn,
      sourceKey: params.columns[sourceColumn].columnKey,
      sourceIndex: params.columns[sourceColumn].taskIds.indexOf(draggingId),
      destColumn,
      destKey: dropTarget.columnKey,
      destIndex: dropTarget.index,
    };
  }, [draggingId, dropTarget, itemGap, lift, params.columns]);

  /**
   * How far the card at `index` slides to make room. Cards below the slot the
   * lifted card left close up behind it, cards from the target slot on move
   * down. A card that is both keeps its place, which is what a drop next to
   * where the card started looks like.
   */
  const offsetFor = useCallback(
    (columnKey: string, index: number): number => {
      if (!shift) return 0;
      if (columnKey === shift.sourceKey && index === shift.sourceIndex) return 0;
      let offset = 0;
      if (columnKey === shift.sourceKey && index > shift.sourceIndex) offset -= shift.height;
      if (columnKey === shift.destKey && index >= shift.destIndex) offset += shift.height;
      return offset;
    },
    [shift],
  );

  /** Whatever a column renders after its cards, which every card shift pushes. */
  const tailOffsetFor = useCallback(
    (columnKey: string): number => {
      if (!shift) return 0;
      let offset = 0;
      if (columnKey === shift.sourceKey) offset -= shift.height;
      if (columnKey === shift.destKey) offset += shift.height;
      return offset;
    },
    [shift],
  );

  /**
   * Stacked columns move as a block so a gap opened in one does not run over
   * the next. Side-by-side columns are independent, so they never do.
   */
  const groupOffsetFor = useCallback(
    (columnKey: string): number => {
      if (!shift || axis === "horizontal") return 0;
      const index = params.columns.findIndex((c) => c.columnKey === columnKey);
      if (index < 0) return 0;
      let offset = 0;
      if (index > shift.sourceColumn) offset -= shift.height;
      if (index > shift.destColumn) offset += shift.height;
      return offset;
    },
    [axis, params.columns, shift],
  );

  const previewStyle = useAnimatedStyle(() => ({
    width: lift?.width ?? 0,
    transform: [
      { translateX: previewX.value - (lift?.grabX ?? 0) - containerOrigin.x },
      { translateY: previewY.value - (lift?.grabY ?? 0) - containerOrigin.y },
      { scale: 1.04 },
    ],
  }));

  const containerProps = {
    ref: containerRef,
    onLayout: (event: LayoutChangeEvent) => {
      viewport.current = {
        width: event.nativeEvent.layout.width,
        height: event.nativeEvent.layout.height,
      };
      measureOrigin();
    },
  };

  const verticalScrollProps = {
    ref: verticalRef,
    scrollEnabled: draggingId === null,
    scrollEventThrottle: 16,
    onScroll: (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      scroll.current.y = event.nativeEvent.contentOffset.y;
    },
    onContentSizeChange: (_width: number, height: number) => {
      content.current.height = height;
    },
  };

  const horizontalScrollProps = {
    ref: horizontalRef,
    scrollEnabled: draggingId === null,
    scrollEventThrottle: 16,
    onScroll: (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      scroll.current.x = event.nativeEvent.contentOffset.x;
    },
    onContentSizeChange: (width: number) => {
      content.current.width = width;
    },
  };

  return {
    draggingId,
    dropTarget,
    previewStyle,
    gestureFor,
    offsetFor,
    tailOffsetFor,
    groupOffsetFor,
    registerGroup,
    registerList,
    registerItem,
    unregisterGroup,
    unregisterList,
    unregisterItem,
    containerProps,
    verticalScrollProps,
    horizontalScrollProps,
  };
}

export type TaskDragController = ReturnType<typeof useTaskDrag>;
