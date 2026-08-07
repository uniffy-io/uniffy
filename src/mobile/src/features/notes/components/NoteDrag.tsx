import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Alert, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import type {
  FlatList,
  NativeScrollEvent,
  NativeSyntheticEvent,
  StyleProp,
  ViewStyle,
} from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, { runOnJS, useAnimatedStyle, useSharedValue } from "react-native-reanimated";
import type { SharedValue } from "react-native-reanimated";
import * as Haptics from "expo-haptics";
import { FolderSimple, Graph, NotePencil } from "phosphor-react-native";
import { AccessMode } from "@uniffy/proto/common/v1/common_pb";
import { useTheme } from "@shared/hooks/useTheme";
import { FONT } from "@theme/typography";
import { useMoveNote } from "@features/notes/useNoteMutations";
import type { TreeNode } from "@features/notes/useNotesTree";

export type DragNote = {
  id: string;
  title: string;
  parentId: string | null;
  accessMode: number;
  isCanvas: boolean;
  isFolder: boolean;
  iconValue: string | null;
  /** Folder drags carry their subtree so one can never drop into itself. */
  descendantIds: string[];
};

export type DropFolder = { id: string; accessMode: number };

function collectIds(nodes: TreeNode[] | undefined): string[] {
  const out: string[] = [];
  for (const node of nodes ?? []) {
    out.push(node.id, ...collectIds(node.children));
  }
  return out;
}

export function toDragNote(node: TreeNode): DragNote {
  const isFolder = node.type === "folder";
  return {
    id: node.id,
    title: node.title,
    parentId: node.parentId ?? null,
    accessMode: node.accessMode,
    isCanvas: node.isCanvas,
    isFolder,
    iconValue: node.icon?.value ?? null,
    descendantIds: isFolder ? collectIds(node.children) : [],
  };
}

const DRAG_ACTIVATE_MS = 280;
// Window-edge bands that trigger auto-scroll. Generous on purpose: the top band
// overlaps the header chrome, where "keep scrolling up" is the only sane intent.
const AUTO_SCROLL_EDGE = 170;
const AUTO_SCROLL_STEP = 12;
const AUTO_SCROLL_INTERVAL_MS = 16;

// Which move a drop would perform, or null for the one pointless case (the
// folder the note is already in). Mirrors the web sidebar's handleDrop: the
// note adopts the target folder's access mode whenever the two differ, and
// only going org-wide asks first.
function dropPlan(
  note: DragNote,
  folder: DropFolder,
): { targetAccessMode?: AccessMode; confirmOrg: boolean } | null {
  if (folder.id === note.id || folder.id === note.parentId) return null;
  if (note.descendantIds.includes(folder.id)) return null;
  if (folder.accessMode === note.accessMode) return { confirmOrg: false };
  return {
    targetAccessMode: folder.accessMode as AccessMode,
    confirmOrg: folder.accessMode === AccessMode.OPEN_TO_ORG,
  };
}

type DragApi = {
  ghostX: SharedValue<number>;
  ghostY: SharedValue<number>;
  beginDrag: (note: DragNote, x: number, y: number) => void;
  updateDrag: (x: number, y: number) => void;
  finishDrag: () => void;
  cancelDrag: () => void;
  registerTarget: (id: string, ref: React.RefObject<View | null>, folder: DropFolder) => void;
  unregisterTarget: (id: string) => void;
  setListRef: (node: FlatList<any> | null) => void;
  onListScroll: (e: NativeSyntheticEvent<NativeScrollEvent>) => void;
};

type DragState = { draggingId: string | null; activeDropId: string | null };

const DragApiContext = createContext<DragApi | null>(null);
const DragStateContext = createContext<DragState>({ draggingId: null, activeDropId: null });

function useNoteDragApi(): DragApi {
  const api = useContext(DragApiContext);
  if (!api) throw new Error("NoteDrag components must be rendered inside NoteDragProvider");
  return api;
}

/** Hands the screen the FlatList wiring auto-scroll needs during a drag. */
export function useNoteDragList() {
  const { setListRef, onListScroll } = useNoteDragApi();
  return { setListRef, onListScroll };
}

type TargetEntry = { ref: React.RefObject<View | null>; folder: DropFolder };
type TargetRect = { x: number; y: number; w: number; h: number; atOffset: number };

export function NoteDragProvider({ children }: { children: React.ReactNode }) {
  const T = useTheme();
  const { height: windowHeight } = useWindowDimensions();
  const { mutate: mutateMove } = useMoveNote();

  const [dragNote, setDragNote] = useState<DragNote | null>(null);
  const [activeDropId, setActiveDropId] = useState<string | null>(null);
  const dragNoteRef = useRef<DragNote | null>(null);
  const activeDropIdRef = useRef<string | null>(null);

  const targetsRef = useRef(new Map<string, TargetEntry>());
  const rectsRef = useRef(new Map<string, TargetRect>());

  const scrollRef = useRef<FlatList<any> | null>(null);
  const scrollOffsetRef = useRef(0);
  const scrollMaxRef = useRef(Number.MAX_SAFE_INTEGER);
  const autoScrollTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const autoScrollDir = useRef(0);
  const lastPointRef = useRef({ x: 0, y: 0 });

  const ghostX = useSharedValue(0);
  const ghostY = useSharedValue(0);
  // Gesture coordinates are window-based; the ghost is positioned inside this
  // container, so its window origin is subtracted per frame.
  const containerX = useSharedValue(0);
  const containerY = useSharedValue(0);
  const containerRef = useRef<View | null>(null);

  const measureTarget = useCallback((id: string) => {
    targetsRef.current.get(id)?.ref.current?.measureInWindow((x, y, w, h) => {
      rectsRef.current.set(id, { x, y, w, h, atOffset: scrollOffsetRef.current });
    });
  }, []);

  const setActive = useCallback((id: string | null) => {
    if (activeDropIdRef.current === id) return;
    activeDropIdRef.current = id;
    setActiveDropId(id);
    if (id) Haptics.selectionAsync();
  }, []);

  const hitTest = useCallback(
    (x: number, y: number) => {
      const note = dragNoteRef.current;
      if (!note) return;
      let hit: string | null = null;
      for (const [id, r] of rectsRef.current) {
        // Rects were measured at drag start; list rows shift as one block with
        // the scroll offset, so the delta corrects them without re-measuring.
        const top = r.y - (scrollOffsetRef.current - r.atOffset);
        if (x >= r.x && x <= r.x + r.w && y >= top && y <= top + r.h) {
          const folder = targetsRef.current.get(id)?.folder;
          if (folder && dropPlan(note, folder)) hit = id;
          break;
        }
      }
      setActive(hit);
    },
    [setActive],
  );

  const stopAutoScroll = useCallback(() => {
    if (autoScrollTimer.current) {
      clearInterval(autoScrollTimer.current);
      autoScrollTimer.current = null;
    }
    autoScrollDir.current = 0;
  }, []);

  const autoScrollTick = useCallback(() => {
    const next = Math.min(
      Math.max(scrollOffsetRef.current + autoScrollDir.current * AUTO_SCROLL_STEP, 0),
      scrollMaxRef.current,
    );
    if (next === scrollOffsetRef.current) return;
    scrollOffsetRef.current = next;
    scrollRef.current?.scrollToOffset({ offset: next, animated: false });
    // The finger is stationary while content moves beneath it, so the hover
    // target has to be re-derived on every scrolled frame.
    hitTest(lastPointRef.current.x, lastPointRef.current.y);
  }, [hitTest]);

  const updateAutoScroll = useCallback(
    (y: number) => {
      let dir = 0;
      if (y < AUTO_SCROLL_EDGE) dir = -1;
      else if (y > windowHeight - AUTO_SCROLL_EDGE) dir = 1;
      if (dir === autoScrollDir.current) return;
      stopAutoScroll();
      autoScrollDir.current = dir;
      if (dir !== 0) {
        autoScrollTimer.current = setInterval(autoScrollTick, AUTO_SCROLL_INTERVAL_MS);
      }
    },
    [windowHeight, stopAutoScroll, autoScrollTick],
  );

  const onListScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
    scrollOffsetRef.current = contentOffset.y;
    scrollMaxRef.current = Math.max(0, contentSize.height - layoutMeasurement.height);
  }, []);

  const beginDrag = useCallback(
    (note: DragNote, x: number, y: number) => {
      dragNoteRef.current = note;
      lastPointRef.current = { x, y };
      setDragNote(note);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      containerRef.current?.measureInWindow((cx, cy) => {
        containerX.value = cx;
        containerY.value = cy;
      });
      rectsRef.current.clear();
      for (const id of targetsRef.current.keys()) measureTarget(id);
    },
    [measureTarget, containerX, containerY],
  );

  const updateDrag = useCallback(
    (x: number, y: number) => {
      if (!dragNoteRef.current) return;
      lastPointRef.current = { x, y };
      hitTest(x, y);
      updateAutoScroll(y);
    },
    [hitTest, updateAutoScroll],
  );

  const resetDrag = useCallback(() => {
    stopAutoScroll();
    dragNoteRef.current = null;
    activeDropIdRef.current = null;
    setDragNote(null);
    setActiveDropId(null);
  }, [stopAutoScroll]);

  const performDrop = useCallback(
    (note: DragNote, folder: DropFolder) => {
      const plan = dropPlan(note, folder);
      if (!plan) return;
      const doMove = () =>
        mutateMove({
          noteId: note.id,
          targetAccessMode: plan.targetAccessMode,
          parentId: folder.id,
        });
      if (plan.confirmOrg) {
        Alert.alert(
          "Move to Organization",
          "Everyone in the organization will be able to see this note, along with anything it references - attached files, mentioned notes and inline media.",
          [
            { text: "Cancel", style: "cancel" },
            { text: "Move to Organization", onPress: doMove },
          ],
        );
        return;
      }
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      doMove();
    },
    [mutateMove],
  );

  const finishDrag = useCallback(() => {
    const note = dragNoteRef.current;
    const dropId = activeDropIdRef.current;
    if (note && dropId) {
      const folder = targetsRef.current.get(dropId)?.folder;
      if (folder) performDrop(note, folder);
    }
    resetDrag();
  }, [performDrop, resetDrag]);

  const registerTarget = useCallback(
    (id: string, ref: React.RefObject<View | null>, folder: DropFolder) => {
      targetsRef.current.set(id, { ref, folder });
      // A row mounting mid-drag (auto-scroll pulled it on screen) still needs a
      // rect; wait a frame so it has a layout to measure.
      if (dragNoteRef.current) requestAnimationFrame(() => measureTarget(id));
    },
    [measureTarget],
  );

  const unregisterTarget = useCallback((id: string) => {
    targetsRef.current.delete(id);
    rectsRef.current.delete(id);
  }, []);

  const setListRef = useCallback((node: FlatList<any> | null) => {
    scrollRef.current = node;
  }, []);

  useEffect(() => stopAutoScroll, [stopAutoScroll]);

  const api = useMemo(
    () => ({
      ghostX,
      ghostY,
      beginDrag,
      updateDrag,
      finishDrag,
      cancelDrag: resetDrag,
      registerTarget,
      unregisterTarget,
      setListRef,
      onListScroll,
    }),
    [
      ghostX,
      ghostY,
      beginDrag,
      updateDrag,
      finishDrag,
      resetDrag,
      registerTarget,
      unregisterTarget,
      setListRef,
      onListScroll,
    ],
  );

  const state = useMemo(
    () => ({ draggingId: dragNote?.id ?? null, activeDropId }),
    [dragNote, activeDropId],
  );

  const ghostStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: ghostX.value - containerX.value - 16 },
      { translateY: ghostY.value - containerY.value - 60 },
    ],
  }));

  return (
    <DragApiContext.Provider value={api}>
      <DragStateContext.Provider value={state}>
        <View ref={containerRef} collapsable={false} style={styles.fill}>
          {children}
          {dragNote ? (
            <Animated.View
              pointerEvents="none"
              style={[
                styles.ghost,
                { backgroundColor: T.surface, borderColor: T.accent },
                ghostStyle,
              ]}
            >
              {dragNote.isFolder ? (
                <FolderSimple size={16} color={T.accent} weight="fill" />
              ) : dragNote.iconValue ? (
                <Text style={styles.ghostEmoji}>{dragNote.iconValue}</Text>
              ) : dragNote.isCanvas ? (
                <Graph size={16} color={T.accent} weight="duotone" />
              ) : (
                <NotePencil size={16} color={T.accent} weight="fill" />
              )}
              <Text style={[styles.ghostTitle, { color: T.textBright }]} numberOfLines={1}>
                {dragNote.title || "Untitled"}
              </Text>
            </Animated.View>
          ) : null}
        </View>
      </DragStateContext.Provider>
    </DragApiContext.Provider>
  );
}

export function DraggableNote({
  note,
  children,
  style,
}: {
  note: DragNote;
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const { ghostX, ghostY, beginDrag, updateDrag, finishDrag, cancelDrag } = useNoteDragApi();
  const { draggingId } = useContext(DragStateContext);

  // Until the hold elapses the pan stays inactive, so taps reach the row and a
  // moving finger lets the list's scroll gesture win.
  const pan = Gesture.Pan()
    .activateAfterLongPress(DRAG_ACTIVATE_MS)
    .onStart((e) => {
      ghostX.value = e.absoluteX;
      ghostY.value = e.absoluteY;
      runOnJS(beginDrag)(note, e.absoluteX, e.absoluteY);
    })
    .onUpdate((e) => {
      ghostX.value = e.absoluteX;
      ghostY.value = e.absoluteY;
      runOnJS(updateDrag)(e.absoluteX, e.absoluteY);
    })
    .onEnd(() => {
      runOnJS(finishDrag)();
    })
    .onFinalize((_e, success) => {
      if (!success) runOnJS(cancelDrag)();
    });

  return (
    <GestureDetector gesture={pan}>
      <View collapsable={false} style={[style, draggingId === note.id && styles.dragSource]}>
        {children}
      </View>
    </GestureDetector>
  );
}

export function FolderDropTarget({
  folder,
  children,
  style,
}: {
  folder: DropFolder;
  children: (active: boolean) => React.ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const { registerTarget, unregisterTarget } = useNoteDragApi();
  const { activeDropId } = useContext(DragStateContext);
  const ref = useRef<View | null>(null);

  const spec = useMemo(
    () => ({ id: folder.id, accessMode: folder.accessMode }),
    [folder.id, folder.accessMode],
  );
  useEffect(() => {
    registerTarget(spec.id, ref, spec);
    return () => unregisterTarget(spec.id);
  }, [spec, registerTarget, unregisterTarget]);

  return (
    <View ref={ref} collapsable={false} style={style}>
      {children(activeDropId === folder.id)}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  ghost: {
    position: "absolute",
    top: 0,
    left: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    maxWidth: 240,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
    elevation: 6,
    shadowColor: "#000",
    shadowOpacity: 0.25,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
  },
  ghostEmoji: { fontSize: 16 },
  ghostTitle: { fontSize: 14, fontFamily: FONT.semibold, flexShrink: 1 },
  dragSource: { opacity: 0.35 },
});
