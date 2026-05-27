interface EnvConfig {
  apiBaseUrl: string;
  mode: string;
  isDev: boolean;
  isProd: boolean;
}

function validateEnv(): void {
  const required: string[] = [];

  for (const key of required) {
    if (!import.meta.env[key]) {
      throw new Error(`Missing required environment variable: ${key}`);
    }
  }
}

function createEnvConfig(): EnvConfig {
  validateEnv();

  const mode = import.meta.env.MODE || 'development';

  return {
    // Backend routes live under /api/*; override with VITE_API_URL for split-origin dev.
    apiBaseUrl: import.meta.env.VITE_API_URL ?? '/api',
    mode,
    isDev: mode === 'development',
    isProd: mode === 'production',
  };
}

export const env = createEnvConfig();
