const STORAGE_KEY_PREFIX = 'uniffy-notes-tree';

function getExpandedNodesKey(organizationId: string, userId: string): string {
    return `${STORAGE_KEY_PREFIX}:expanded:${organizationId}:${userId}`;
}

export function loadExpandedNodes(organizationId: string, userId: string): string[] | null {
    try {
        const key = getExpandedNodesKey(organizationId, userId);
        const stored = localStorage.getItem(key);
        if (stored) {
            const parsed = JSON.parse(stored);
            if (Array.isArray(parsed)) {
                return parsed;
            }
        }
    } catch (error) {
        console.error('[TreeState] Failed to load expanded nodes:', error);
    }
    return null;
}

export function saveExpandedNodes(
    organizationId: string,
    userId: string,
    expandedNodes: string[]
): void {
    try {
        const key = getExpandedNodesKey(organizationId, userId);
        localStorage.setItem(key, JSON.stringify(expandedNodes));
    } catch (error) {
        console.error('[TreeState] Failed to save expanded nodes:', error);
    }
}

export function clearTreeState(organizationId: string, userId: string): void {
    try {
        const key = getExpandedNodesKey(organizationId, userId);
        localStorage.removeItem(key);
    } catch (error) {
        console.error('[TreeState] Failed to clear tree state:', error);
    }
}
