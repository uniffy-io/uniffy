import { expect, type Page, type Locator } from '@playwright/test';
import { messages, streaming } from './selectors';

/**
 * Wait for the SPA to finish auth rehydration and land on the chat surface.
 * Specs that load with `storageState` should call this once after `goto`.
 */
export async function waitForAppReady(page: Page): Promise<void> {
  await page.waitForFunction(
    () => {
      const persisted = window.localStorage.getItem('persist:root');
      if (!persisted) return false;
      try {
        const root = JSON.parse(persisted);
        const auth = JSON.parse(root.auth ?? '{}');
        return Boolean(auth.user && auth.refreshToken);
      } catch {
        return false;
      }
    },
    null,
    { timeout: 10_000 },
  );
}

/**
 * Wait for a chat message row carrying `messageId` to mount in the virtual list.
 */
export async function waitForMessage(page: Page, messageId: string): Promise<Locator> {
  const locator = page.getByTestId(messages.row(messageId));
  await expect(locator).toBeVisible({ timeout: 10_000 });
  return locator;
}

/**
 * Wait for an in-flight agent reply to settle: the StreamingMessage swaps
 * `data-streaming-state` to `settled` once the rAF reveal catches up to
 * the final content.
 */
export async function waitForStreamingComplete(page: Page, options?: { timeout?: number }): Promise<void> {
  const locator = page.getByTestId(streaming.content);
  await expect(locator).toHaveAttribute('data-streaming-state', 'settled', {
    timeout: options?.timeout ?? 20_000,
  });
}

/**
 * Wait for a Sonner toast with matching text. Falls back to a regex match if
 * `text` is a string. Useful for asserting success / error feedback paths.
 */
export async function waitForToast(page: Page, text: string | RegExp): Promise<void> {
  const matcher = typeof text === 'string' ? new RegExp(text, 'i') : text;
  const toast = page.locator('[data-sonner-toast]', { hasText: matcher }).first();
  await expect(toast).toBeVisible({ timeout: 5_000 });
}
