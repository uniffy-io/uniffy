import { useCallback, useEffect, useRef, useState } from "react";
import { useAppDispatch } from "@/app/hooks";
import { feedbackChanged } from "@/features/calls/store/callsSlice";

export function useCallPopout(callId: string | null) {
  const dispatch = useAppDispatch();
  const [popoutWindow, setPopoutWindow] = useState<Window | null>(null);
  const activeId = useRef(callId);
  useEffect(() => {
    activeId.current = callId;
    return () => {
      activeId.current = null;
    };
  }, [callId]);
  const opening = useRef(false);
  const closePopout = useCallback(() => {
    popoutWindow?.close();
    setPopoutWindow(null);
  }, [popoutWindow]);
  const openPopout = useCallback(async () => {
    if (popoutWindow && !popoutWindow.closed) {
      popoutWindow.focus();
      return;
    }
    if (!callId || opening.current) return;
    opening.current = true;
    try {
      const pip = (
        window as Window & {
          documentPictureInPicture?: {
            requestWindow: (options: { width: number; height: number }) => Promise<Window>;
          };
        }
      ).documentPictureInPicture;
      const child = pip
        ? await pip.requestWindow({ width: 640, height: 480 })
        : window.open("", "uniffy-call", "popup,width=640,height=480");
      if (!child) throw new Error("blocked");
      if (activeId.current !== callId) {
        child.close();
        return;
      }
      child.document.title = "Uniffy call";
      document
        .querySelectorAll('style, link[rel="stylesheet"]')
        .forEach((node) => child.document.head.append(node.cloneNode(true)));
      child.document.body.className = "h-dvh overflow-hidden bg-background text-foreground";
      setPopoutWindow(child);
    } catch {
      dispatch(
        feedbackChanged("Could not open call window. Allow pop-ups for this site and try again."),
      );
    } finally {
      opening.current = false;
    }
  }, [callId, popoutWindow, dispatch]);
  useEffect(() => {
    if (!popoutWindow) return;
    const childDocument = popoutWindow.document;
    const syncTheme = () => {
      childDocument.documentElement.setAttribute("class", document.documentElement.className);
      childDocument.documentElement.setAttribute("style", document.documentElement.style.cssText);
    };
    syncTheme();
    const observer = new MutationObserver(syncTheme);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class", "style"],
    });
    const closed = () => setPopoutWindow(null);
    const close = () => popoutWindow.close();
    popoutWindow.addEventListener("pagehide", closed);
    window.addEventListener("pagehide", close);
    return () => {
      observer.disconnect();
      popoutWindow.removeEventListener("pagehide", closed);
      window.removeEventListener("pagehide", close);
      popoutWindow.close();
    };
  }, [popoutWindow, callId]);
  useEffect(() => {
    if (!callId) {
      // eslint-disable-next-line react/react-compiler -- call termination closes its auxiliary window
      closePopout();
    }
  }, [callId, closePopout]);
  return { popoutWindow, openPopout, closePopout };
}
