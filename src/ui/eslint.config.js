import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

const CDN_HOST_PATTERN = String.raw`unpkg\.com|cdn\.jsdelivr\.net|jsdelivr\.com|cdnjs\.cloudflare\.com|cdn\.skypack\.dev|esm\.sh|fonts\.googleapis\.com|fonts\.gstatic\.com|cdn\.tailwindcss\.com|ajax\.googleapis\.com`

const CDN_RULE_MESSAGE =
  'External CDN URL detected. Bundle the asset locally via a Vite "?url" import or vendor it. ' +
  'Runtime CDN fetches leak user IP/referrer, break offline/air-gapped deploys, and create supply-chain risk.'

export default defineConfig([
  globalIgnores(['dist', 'public', '.vite-worker']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    rules: {
      // Empty `catch {}` is a recognised pattern in this codebase: thunks already
      // surface errors via errorToastMiddleware, so swallowing the rejection in
      // the caller is intentional. Empty `if`/`while` blocks remain disallowed.
      'no-empty': ['error', { allowEmptyCatch: true }],
      'no-restricted-syntax': [
        'error',
        {
          selector: `Literal[value=/${CDN_HOST_PATTERN}/i]`,
          message: CDN_RULE_MESSAGE,
        },
        {
          selector: `TemplateElement[value.raw=/${CDN_HOST_PATTERN}/i]`,
          message: CDN_RULE_MESSAGE,
        },
      ],
    },
  },
])
