import { Suspense, useCallback, useEffect, useRef } from "react";
import { useAppDispatch } from "@/app/hooks";
import { PageLoader } from "@/components/feedback/PageLoader";
import { dialogShellClass } from "@/components/ui/popover";
import { cn } from "@/shared/utils/cn";
import { lazyImport } from "@/shared/utils/lazyImport";
import { useOverlayEscape } from "@/shared/hooks/useOverlayEscape";
import { closeThreadPanel } from "@/features/chat/store/chatUiSlice";
import { setActiveThread } from "@/features/chat/store/chatThreadsSlice";

const ThreadPanel = lazyImport(
  () => import("@/features/chat/components/thread/ThreadPanel"),
  "ThreadPanel",
);

/**
 * Thread as a slide-over inside the split pane that owns it. The channel stays
 * mounted and dimmed underneath, so closing returns to the same scroll position.
 */
export function ThreadSlideOver() {
  const dispatch = useAppDispatch();
  const rootRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const close = useCallback(() => {
    dispatch(closeThreadPanel());
    dispatch(setActiveThread(null));
  }, [dispatch]);

  useOverlayEscape(close);

  // Dialog semantics: focus moves into the panel, the channel under the scrim
  // is inert for keyboard and assistive tech, and focus returns on close.
  useEffect(() => {
    const root = rootRef.current;
    if (!root?.parentElement) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const siblings = Array.from(root.parentElement.children).filter(
      (el): el is HTMLElement => el !== root && el instanceof HTMLElement,
    );
    siblings.forEach((el) => {
      el.inert = true;
    });
    panelRef.current?.focus({ preventScroll: true });
    return () => {
      siblings.forEach((el) => {
        el.inert = false;
      });
      if (previouslyFocused?.isConnected) previouslyFocused.focus({ preventScroll: true });
    };
  }, []);

  return (
    <div
      ref={rootRef}
      className="absolute inset-0 z-30 flex justify-end"
      data-testid="chat-thread-slideover"
    >
      <div
        className="thread-slideover-scrim absolute inset-0 bg-background/55 backdrop-blur-[2px]"
        onClick={close}
        aria-hidden="true"
      />
      <div
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label="Thread"
        className={cn(
          dialogShellClass,
          "thread-slideover-panel relative h-full w-full max-w-[36rem] outline-none",
        )}
      >
        <Suspense fallback={<PageLoader className="h-full min-h-0" />}>
          <ThreadPanel overlay />
        </Suspense>
      </div>
    </div>
  );
}
