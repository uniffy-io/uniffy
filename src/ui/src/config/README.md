# Configuration Module

Centralized configuration management for the UNIFFY frontend application.

## Overview

This module provides a single source of truth for all application configuration, including environment variables and API client setup. All environment-dependent values should be accessed through this module.

## Structure

```
src/config/
├── index.ts      # Main entry point - exports all config
├── env.ts        # Environment variable parsing and validation
└── api.ts        # ConnectRPC transport configuration
```

## Usage

### Environment Variables

Access environment configuration through the `env` object:

```typescript
import { env } from "@/config";

console.log(env.apiBaseUrl); // Backend API URL
console.log(env.isDev); // true in development
console.log(env.isProd); // true in production
```

### API Transport

Use the centralized transport for all ConnectRPC clients:

```typescript
import { createClient } from "@connectrpc/connect";
import { transport } from "@/config";
import { AuthService } from "@/gen/auth/v1/auth_connect";

const client = createClient(AuthService, transport);
```

**Benefits:**

- Consistent configuration across all API calls
- Single point of configuration for baseUrl
- Easy to mock in tests
- Proper TypeScript typing

## Adding New Environment Variables

1. Add the variable to `.env` files (`.env`, `.env.local`, etc.)
2. Update the `EnvConfig` interface in `env.ts`
3. Add the variable to the `createEnvConfig()` function
4. If required, add validation in `validateEnv()`

Example:

```typescript
// In env.ts
interface EnvConfig {
  apiBaseUrl: string;
  // Add new variable
  featureFlagX: boolean;
}

function createEnvConfig(): EnvConfig {
  return {
    apiBaseUrl: import.meta.env.VITE_API_URL || "http://dev.local.uniffy.io:8000",
    // Parse new variable
    featureFlagX: import.meta.env.VITE_FEATURE_X === "true",
  };
}
```

## Best Practices

### DO ✓

- Import from `@/config` for all environment and API configuration
- Use the shared `transport` instance for all ConnectRPC clients
- Add new environment variables to this module
- Keep environment-specific logic in this module

### DON'T ✗

- Access `import.meta.env` directly outside this module
- Create new transport instances in components or pages
- Hardcode API URLs or environment-specific values
- Mix configuration logic with business logic

## Environment Files

The application uses Vite's environment variable system:

- `.env` - Default values (committed to git)
- `.env.local` - Local overrides (not committed)
- `.env.production` - Production values
- `.env.development` - Development values

All environment variables must be prefixed with `VITE_` to be exposed to the client.

## Migration Guide

If you have existing code with hardcoded configuration:

**Before:**

```typescript
const API_BASE_URL = import.meta.env.VITE_API_URL || "http://dev.local.uniffy.io:8000";
const transport = createConnectTransport({ baseUrl: API_BASE_URL });
```

**After:**

```typescript
import { transport } from "@/config";
```

That's it! No need to recreate the transport or access environment variables directly.
