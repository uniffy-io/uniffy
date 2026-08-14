import { useCallback, useMemo } from "react";
import { notificationsApi } from "@/features/notifications/api/notificationsApi";

/** Decode VAPID base64url public key into the Uint8Array `applicationServerKey` expects. */
function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i++) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray as Uint8Array<ArrayBuffer>;
}

function isPushSupported(): boolean {
  return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

function getPermissionState(): NotificationPermission | "unsupported" {
  if (!isPushSupported()) return "unsupported";
  return Notification.permission;
}

export interface SubscribeResult {
  success: boolean;
  error?: string;
}

export interface UsePushSubscriptionResult {
  subscribe: () => Promise<SubscribeResult>;
  unsubscribe: () => Promise<boolean>;
  permissionState: NotificationPermission | "unsupported";
  isSupported: boolean;
}

export function usePushSubscription(): UsePushSubscriptionResult {
  const permissionState = useMemo(() => getPermissionState(), []);
  const isSupported = useMemo(() => isPushSupported(), []);

  const subscribe = useCallback(async (): Promise<SubscribeResult> => {
    if (!isPushSupported())
      return { success: false, error: "Push notifications are not supported in this browser." };

    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        return { success: false, error: "Notification permission was denied." };
      }

      const { publicKey } = await notificationsApi.getVapidPublicKey({});
      if (!publicKey)
        return { success: false, error: "Could not retrieve push configuration from server." };

      // Dedicated notification-only worker (no auth/fetch); registered on demand when the user opts in.
      const registration = await navigator.serviceWorker.register("/notification-worker.js");
      await navigator.serviceWorker.ready;

      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      });

      const rawKey = subscription.getKey("p256dh");
      const rawAuth = subscription.getKey("auth");
      if (!rawKey || !rawAuth)
        return { success: false, error: "Failed to extract push subscription keys." };

      const p256dhKey = btoa(String.fromCharCode(...new Uint8Array(rawKey)))
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/, "");
      const authKey = btoa(String.fromCharCode(...new Uint8Array(rawAuth)))
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/, "");

      await notificationsApi.registerPushSubscription({
        endpoint: subscription.endpoint,
        p256dhKey,
        authKey,
        userAgent: navigator.userAgent,
      });

      return { success: true };
    } catch (error) {
      console.error("[usePushSubscription] subscribe failed:", error);

      if (error instanceof DOMException && error.name === "AbortError") {
        return {
          success: false,
          error:
            "Push service registration failed. Your browser may block push services. Check your browser privacy settings.",
        };
      }
      if (error instanceof DOMException && error.name === "NotAllowedError") {
        return { success: false, error: "Notification permission was denied." };
      }

      return { success: false, error: "Could not enable notifications. Please try again later." };
    }
  }, []);

  const unsubscribe = useCallback(async (): Promise<boolean> => {
    if (!isPushSupported()) return false;

    try {
      const registration = await navigator.serviceWorker.getRegistration("/");
      if (!registration) return false;

      const subscription = await registration.pushManager.getSubscription();
      if (!subscription) return false;

      const endpoint = subscription.endpoint;

      await subscription.unsubscribe();
      await notificationsApi.unregisterPushSubscription({ endpoint });

      return true;
    } catch (error) {
      console.error("[usePushSubscription] unsubscribe failed:", error);
      return false;
    }
  }, []);

  return { subscribe, unsubscribe, permissionState, isSupported };
}
