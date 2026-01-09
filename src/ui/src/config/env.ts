/**
 * Environment Configuration
 * 
 * Centralized environment variable access with type safety and validation.
 * All environment variables should be accessed through this module.
 */

interface EnvConfig {
  /** Backend API base URL */
  apiBaseUrl: string;
  /** Current environment mode */
  mode: string;
  /** Whether running in development mode */
  isDev: boolean;
  /** Whether running in production mode */
  isProd: boolean;
}

/**
 * Validates that required environment variables are present
 */
function validateEnv(): void {
  const required: string[] = [];
  
  for (const key of required) {
    if (!import.meta.env[key]) {
      throw new Error(`Missing required environment variable: ${key}`);
    }
  }
}

/**
 * Parses and exports environment configuration
 */
function createEnvConfig(): EnvConfig {
  validateEnv();
  
  const mode = import.meta.env.MODE || 'development';
  
  return {
    apiBaseUrl: import.meta.env.VITE_API_URL || 'http://dev.local.uniffy.io:8000',
    mode,
    isDev: mode === 'development',
    isProd: mode === 'production',
  };
}

/**
 * Application environment configuration.
 * Access environment variables through this object.
 */
export const env = createEnvConfig();
