import { test as setup, expect } from '@playwright/test';
import { writeFileSync, mkdirSync, existsSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loginViaApi, getCurrentUserViaApi } from '../fixtures/api';

const __dirname = dirname(fileURLToPath(import.meta.url));
const STATE_DIR = resolve(__dirname, '..', 'storageState');
const FRESH_TTL_MS = 10 * 60_000;

interface RoleConfig {
  name: string;
  email: string;
  password: string;
}

const ROLES: RoleConfig[] = [
  {
    name: 'admin',
    email: process.env.E2E_ADMIN_EMAIL ?? 'admin@uniffy.io',
    password: process.env.E2E_ADMIN_PASSWORD ?? 'admin',
  },
  {
    name: 'alice',
    email: process.env.E2E_ALICE_EMAIL ?? 'alice@uniffy.io',
    password: process.env.E2E_DEFAULT_PASSWORD ?? 'admin',
  },
  {
    name: 'bob',
    email: process.env.E2E_BOB_EMAIL ?? 'bob@uniffy.io',
    password: process.env.E2E_DEFAULT_PASSWORD ?? 'admin',
  },
];

function isFresh(path: string): boolean {
  if (!existsSync(path)) return false;
  const age = Date.now() - statSync(path).mtimeMs;
  return age < FRESH_TTL_MS;
}

function buildStorageState(args: {
  origin: string;
  refreshToken: string;
  user: unknown;
  currentOrganizationId: string;
  currentOrganizationRole: string;
}): string {
  // Mirror the redux-persist shape that `localStorage['persist:root']` holds.
  // Each slice value is itself a JSON-stringified blob; the rehydration path
  // in src/ui/src/config/api.ts reads auth.refreshToken / auth.user /
  // auth.currentOrganizationId / auth.currentOrganizationRole and calls
  // RefreshToken to mint a fresh access token on first nav.
  const authSlice = JSON.stringify({
    user: args.user,
    accessToken: null,
    refreshToken: args.refreshToken,
    currentOrganizationId: args.currentOrganizationId,
    currentOrganizationRole: args.currentOrganizationRole,
    domainAdminDomains: [],
    currentSessionId: null,
    isAuthenticated: true,
    isRehydrating: false,
  });
  const persistRoot = JSON.stringify({
    auth: authSlice,
    _persist: JSON.stringify({ version: -1, rehydrated: true }),
  });
  return JSON.stringify({
    cookies: [],
    origins: [
      {
        origin: args.origin,
        localStorage: [{ name: 'persist:root', value: persistRoot }],
      },
    ],
  });
}

for (const role of ROLES) {
  setup(`authenticate ${role.name}`, async () => {
    if (!existsSync(STATE_DIR)) {
      mkdirSync(STATE_DIR, { recursive: true });
    }
    const outPath = resolve(STATE_DIR, `${role.name}.json`);

    if (isFresh(outPath)) {
      setup.skip(true, `storageState/${role.name}.json fresh (< 10m old)`);
      return;
    }

    const auth = await loginViaApi(role.email, role.password);
    expect(auth.accessToken, `login should return access token for ${role.name}`).toBeTruthy();
    expect(auth.refreshToken).toBeTruthy();

    const user = await getCurrentUserViaApi(auth.accessToken);
    expect(user.id).toBeTruthy();

    const baseURL = process.env.E2E_BASE_URL ?? 'http://localhost:5173';
    const stateJson = buildStorageState({
      origin: baseURL,
      refreshToken: auth.refreshToken,
      user,
      currentOrganizationId: auth.organizationId ?? '',
      currentOrganizationRole: auth.organizationRole ?? '',
    });
    writeFileSync(outPath, stateJson);
  });
}
