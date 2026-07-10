import { randomUUID } from '@/shared/utils/uuid';

const STORAGE_KEY = 'uniffy_device_id';

let sessionFallback: string | null = null;

/**
 * Stable per-browser device id. Tabs of the same browser share it, which is
 * what lets the backend cap devices per call and the second tab detect the
 * collision via BroadcastChannel.
 */
export function getDeviceId(): string {
  try {
    const existing = localStorage.getItem(STORAGE_KEY);
    if (existing) return existing;
    const id = randomUUID();
    localStorage.setItem(STORAGE_KEY, id);
    return id;
  } catch {
    sessionFallback ??= randomUUID();
    return sessionFallback;
  }
}

export function getDeviceLabel(): string {
  const ua = navigator.userAgent;
  let browser = 'Browser';
  if (/edg\//i.test(ua)) browser = 'Edge';
  else if (/firefox\//i.test(ua)) browser = 'Firefox';
  else if (/chrome\//i.test(ua)) browser = 'Chrome';
  else if (/safari\//i.test(ua)) browser = 'Safari';

  let os = '';
  if (/windows/i.test(ua)) os = 'Windows';
  else if (/mac os x/i.test(ua)) os = 'macOS';
  else if (/android/i.test(ua)) os = 'Android';
  else if (/iphone|ipad/i.test(ua)) os = 'iOS';
  else if (/linux/i.test(ua)) os = 'Linux';

  return os ? `${browser} on ${os}` : browser;
}
