import { useCallback, useEffect, useRef, useState } from 'react';
import { useReactFlow } from '@xyflow/react';
import { useDocAwareness } from '@/features/realtime';
import { PeerAvatar } from '@/features/realtime/components/PeerAvatar';
import type { CanvasRealtimeBinding } from '@/features/notes/realtime/useCanvasRealtimeSession';
import {
  AUTO_CURSORS_HIDE_THRESHOLD,
  type CanvasCursorsMode,
} from '@/features/notes/store/editorSlice';

interface CanvasAwarenessPayload {
  user?: {
    id?: string | null;
    name?: string;
    color?: string;
    hasAvatar?: boolean;
  };
  pointer?: { x: number; y: number };
  selection?: string[];
}

interface CanvasAwarenessOverlayProps {
  binding: CanvasRealtimeBinding | null;
  containerRef: React.RefObject<HTMLDivElement | null>;
  /** Visibility mode for remote cursors. `'auto'` hides cursors past `AUTO_CURSORS_HIDE_THRESHOLD` peers. */
  cursorsMode?: CanvasCursorsMode;
  onPeerCountChange?: (count: number) => void;
}

const POINTER_THROTTLE_MS = 30;

export function CanvasAwarenessOverlay({
  binding,
  containerRef,
  cursorsMode = 'auto',
  onPeerCountChange,
}: CanvasAwarenessOverlayProps) {
  const { screenToFlowPosition, flowToScreenPosition } = useReactFlow();
  const lastEmitRef = useRef(0);
  const pendingRef = useRef<{ x: number; y: number } | null>(null);
  const [containerRect, setContainerRect] = useState<DOMRect | null>(null);

  const peers = useDocAwareness<CanvasAwarenessPayload>(binding?.awareness ?? null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver(() => {
      setContainerRect(el.getBoundingClientRect());
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [containerRef]);

  const flushPointer = useCallback(() => {
    if (!binding || !pendingRef.current) return;
    const next = pendingRef.current;
    pendingRef.current = null;
    lastEmitRef.current = performance.now();
    const local = binding.awareness.getLocalState() ?? {};
    binding.awareness.setLocalState({ ...local, pointer: next });
  }, [binding]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el || !binding) return;

    const handleMove = (event: PointerEvent) => {
      const flow = screenToFlowPosition({ x: event.clientX, y: event.clientY });
      pendingRef.current = { x: flow.x, y: flow.y };
      const now = performance.now();
      if (now - lastEmitRef.current >= POINTER_THROTTLE_MS) {
        flushPointer();
      }
    };
    const handleLeave = () => {
      pendingRef.current = null;
      const local = binding.awareness.getLocalState() ?? {};
      if (local.pointer) {
        const rest = { ...(local as Record<string, unknown>) };
        delete rest.pointer;
        binding.awareness.setLocalState(rest);
      }
    };

    el.addEventListener('pointermove', handleMove);
    el.addEventListener('pointerleave', handleLeave);
    const interval = window.setInterval(flushPointer, POINTER_THROTTLE_MS);
    return () => {
      el.removeEventListener('pointermove', handleMove);
      el.removeEventListener('pointerleave', handleLeave);
      window.clearInterval(interval);
    };
  }, [binding, containerRef, flushPointer, screenToFlowPosition]);

  const peerCount = peers.length;
  // Notify via effect so parent's setState does not tear the render phase.
  useEffect(() => {
    onPeerCountChange?.(peerCount);
  }, [peerCount, onPeerCountChange]);

  if (!binding) return null;

  const cursorsVisible =
    cursorsMode === 'on'
    || (cursorsMode === 'auto' && peerCount <= AUTO_CURSORS_HIDE_THRESHOLD);
  if (!cursorsVisible) return null;

  // Dedupe by user.id: a peer mid-refresh holds two awareness clientIds
  // during y-protocols' 30s GC window and would otherwise render twice.
  const seenUserIds = new Set<string>();

  return (
    <div className="pointer-events-none absolute inset-0 z-20 overflow-hidden">
      {peers.map((peer) => {
        const payload = peer.state;
        if (!payload?.pointer) return null;
        const user = payload.user;
        const userId = user?.id ?? null;
        if (userId) {
          if (seenUserIds.has(userId)) return null;
          seenUserIds.add(userId);
        }
        const screen = flowToScreenPosition(payload.pointer);
        const x = containerRect ? screen.x - containerRect.left : screen.x;
        const y = containerRect ? screen.y - containerRect.top : screen.y;
        const color = user?.color ?? '#6366f1';
        return (
          <div
            key={userId ?? peer.clientId}
            className="absolute"
            style={{ left: x, top: y }}
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 18 18"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
              style={{ filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.35))' }}
            >
              <path
                d="M2 2L16 8.5L9 10L6 16L2 2Z"
                fill={color}
                stroke="white"
                strokeWidth="1.25"
                strokeLinejoin="round"
              />
            </svg>
            <div className="absolute left-3.5 top-3.5">
              <PeerAvatar
                userId={userId}
                name={user?.name ?? 'Anonymous'}
                color={color}
                hasAvatar={Boolean(user?.hasAvatar)}
                sizeClass="h-6 w-6 text-[10px]"
                className="ring-2 ring-white/80 dark:ring-card"
                title={user?.name ?? 'Anonymous'}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}
