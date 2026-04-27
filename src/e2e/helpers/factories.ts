import { test as base } from '@playwright/test';
import {
  chatClient,
  agentsClient,
  loginViaApi,
  type LoggedInAuth,
} from '../fixtures/api';

/**
 * Test data factories. Each factory:
 *   - creates the resource via API (fast, deterministic)
 *   - registers a cleanup hook on the test fixture
 *   - returns the typed result so the spec can drive the UI against it
 *
 * Specs should never depend on seed-only state for content they mutate.
 * Use these factories so re-runs are idempotent and parallel-safe.
 */

const RAND_LEN = 6;

export function uniqueSuffix(): string {
  // Crypto-random base36 chunk; collision odds at parallelism <= 10 are negligible
  return Math.random().toString(36).slice(2, 2 + RAND_LEN);
}

export function randomChannelName(prefix = 'e2e'): string {
  return `${prefix}-${Date.now().toString(36)}-${uniqueSuffix()}`;
}

export function randomAgentName(prefix = 'E2E Agent'): string {
  return `${prefix} ${uniqueSuffix()}`;
}

export interface CreatedChannel {
  id: string;
  name: string;
}

export interface CreatedAgent {
  id: string;
  name: string;
}

/**
 * Spec-scoped fixtures. Use as:
 *
 *   import { test } from '@e2e/helpers/factories';
 *
 *   test('foo', async ({ page, withChannel }) => {
 *     const channel = await withChannel();
 *     await page.goto(`/chat/${channel.id}`);
 *   });
 */
export const test = base.extend<{
  adminAuth: LoggedInAuth;
  withChannel: (opts?: { name?: string; isPrivate?: boolean }) => Promise<CreatedChannel>;
  withAgent: (opts?: { name?: string }) => Promise<CreatedAgent>;
}>({
  adminAuth: async ({}, use) => {
    const auth = await loginViaApi(
      process.env.E2E_ADMIN_EMAIL ?? 'admin@uniffy.io',
      process.env.E2E_ADMIN_PASSWORD ?? 'admin',
    );
    await use(auth);
  },

  withChannel: async ({ adminAuth }, use) => {
    const created: CreatedChannel[] = [];
    const factory = async (opts?: { name?: string; isPrivate?: boolean }) => {
      const client = chatClient(adminAuth.accessToken);
      const name = opts?.name ?? randomChannelName();
      const res = await client.createChannel({
        name,
        channelType: opts?.isPrivate ? 2 /* PRIVATE */ : 1 /* PUBLIC */,
      });
      const id = res.channel?.id;
      if (!id) throw new Error('createChannel returned no id');
      const channel = { id, name };
      created.push(channel);
      return channel;
    };
    await use(factory);
    const client = chatClient(adminAuth.accessToken);
    for (const c of created) {
      try {
        await client.deleteChannel({ channelId: c.id });
      } catch {
        // best-effort cleanup
      }
    }
  },

  withAgent: async ({ adminAuth }, use) => {
    const created: CreatedAgent[] = [];
    const factory = async (opts?: { name?: string }) => {
      const client = agentsClient(adminAuth.accessToken);
      const name = opts?.name ?? randomAgentName();
      const res = await client.createAgent({ name });
      const id = res.agent?.id;
      if (!id) throw new Error('createAgent returned no id');
      const agent = { id, name };
      created.push(agent);
      return agent;
    };
    await use(factory);
    const client = agentsClient(adminAuth.accessToken);
    for (const a of created) {
      try {
        await client.deleteAgent({ agentId: a.id });
      } catch {
        // best-effort cleanup
      }
    }
  },
});

export { expect } from '@playwright/test';
