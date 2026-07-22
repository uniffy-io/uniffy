const STORAGE_KEY_PREFIX = 'uniffy-last-channel';

function getStorageKey(organizationId: string, userId: string): string {
    return `${STORAGE_KEY_PREFIX}:${organizationId}:${userId}`;
}

export function loadLastOpenedChannel(organizationId: string, userId: string): string | null {
    try {
        return localStorage.getItem(getStorageKey(organizationId, userId));
    } catch {
        return null;
    }
}

export function saveLastOpenedChannel(organizationId: string, userId: string, channelId: string): void {
    try {
        localStorage.setItem(getStorageKey(organizationId, userId), channelId);
    } catch {
        // Ignore storage errors
    }
}

export function clearLastOpenedChannel(organizationId: string, userId: string): void {
    try {
        localStorage.removeItem(getStorageKey(organizationId, userId));
    } catch {
        // Ignore storage errors
    }
}
