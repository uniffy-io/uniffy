/** Routes clicks on web-push notifications when a tab is already open; the worker focuses that tab and posts the target instead of opening a second window. */

import { useEffect } from "react";
import { useNavigate } from "react-router-dom";

export function usePushNotificationClick(): void {
  const navigate = useNavigate();

  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    const handleMessage = (event: MessageEvent) => {
      const data = event.data as { type?: string; url?: string } | null;
      if (data?.type !== "PUSH_NOTIFICATION_CLICK" || !data.url) return;
      navigate(data.url);
    };

    navigator.serviceWorker.addEventListener("message", handleMessage);
    return () => navigator.serviceWorker.removeEventListener("message", handleMessage);
  }, [navigate]);
}
