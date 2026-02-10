/**
 * Hook for managing Web Push subscription lifecycle.
 *
 * Handles browser permission request, service worker registration,
 * push manager subscription, and backend registration/unregistration.
 */

import { useCallback, useMemo } from 'react';
import { notificationsApi } from '@/features/notifications/api/notificationsApi';

/**
 * Convert a base64url string to a Uint8Array for applicationServerKey.
 */
function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
    const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const rawData = window.atob(base64);
    const outputArray = new Uint8Array(rawData.length);
    for (let i = 0; i < rawData.length; i++) {
        outputArray[i] = rawData.charCodeAt(i);
    }
    return outputArray as Uint8Array<ArrayBuffer>;
}

/**
 * Check if the browser supports push notifications.
 */
function isPushSupported(): boolean {
    return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

/**
 * Get the current Notification permission state.
 */
function getPermissionState(): NotificationPermission | 'unsupported' {
    if (!isPushSupported()) return 'unsupported';
    return Notification.permission;
}

export interface UsePushSubscriptionResult {
    /** Subscribe to push notifications (requests permission + registers). */
    subscribe: () => Promise<boolean>;
    /** Unsubscribe from push notifications. */
    unsubscribe: () => Promise<boolean>;
    /** Current permission state. */
    permissionState: NotificationPermission | 'unsupported';
    /** Whether push is supported in this browser. */
    isSupported: boolean;
}

export function usePushSubscription(): UsePushSubscriptionResult {
    const permissionState = useMemo(() => getPermissionState(), []);
    const isSupported = useMemo(() => isPushSupported(), []);

    const subscribe = useCallback(async (): Promise<boolean> => {
        if (!isPushSupported()) return false;

        try {
            // Request browser permission
            const permission = await Notification.requestPermission();
            if (permission !== 'granted') return false;

            // Fetch VAPID public key from backend
            const { publicKey } = await notificationsApi.getVapidPublicKey({});
            if (!publicKey) return false;

            // Use the existing media-stream service worker (already registered at /)
            // Push event handling is built into the same worker.
            const registration = await navigator.serviceWorker.ready;

            // Subscribe via PushManager
            const subscription = await registration.pushManager.subscribe({
                userVisibleOnly: true,
                applicationServerKey: urlBase64ToUint8Array(publicKey),
            });

            // Extract keys for backend
            const rawKey = subscription.getKey('p256dh');
            const rawAuth = subscription.getKey('auth');
            if (!rawKey || !rawAuth) return false;

            const p256dhKey = btoa(String.fromCharCode(...new Uint8Array(rawKey)))
                .replace(/\+/g, '-')
                .replace(/\//g, '_')
                .replace(/=+$/, '');
            const authKey = btoa(String.fromCharCode(...new Uint8Array(rawAuth)))
                .replace(/\+/g, '-')
                .replace(/\//g, '_')
                .replace(/=+$/, '');

            // Register with backend
            await notificationsApi.registerPushSubscription({
                endpoint: subscription.endpoint,
                p256dhKey,
                authKey,
                userAgent: navigator.userAgent,
            });

            return true;
        } catch (error) {
            console.error('[usePushSubscription] subscribe failed:', error);
            return false;
        }
    }, []);

    const unsubscribe = useCallback(async (): Promise<boolean> => {
        if (!isPushSupported()) return false;

        try {
            const registration = await navigator.serviceWorker.getRegistration('/');
            if (!registration) return false;

            const subscription = await registration.pushManager.getSubscription();
            if (!subscription) return false;

            const endpoint = subscription.endpoint;

            // Unsubscribe from browser
            await subscription.unsubscribe();

            // Unregister from backend
            await notificationsApi.unregisterPushSubscription({ endpoint });

            return true;
        } catch (error) {
            console.error('[usePushSubscription] unsubscribe failed:', error);
            return false;
        }
    }, []);

    return { subscribe, unsubscribe, permissionState, isSupported };
}
