import { defineConfig } from 'oxlint';
import native from 'oxlint-config-universe/native';

// Layering: app -> features -> shared -> core -> theme. Dependencies point one way.
// Lower layers must never import from higher ones, or the layering rots into a cycle.
const layerRestriction = (groups: string[], message: string) => ({
  'no-restricted-imports': ['error', { patterns: [{ group: groups, message }] }],
});

export default defineConfig({
  extends: [native],
  ignorePatterns: ['dist'],
  plugins: ['unicorn'],
  jsPlugins: [{ name: 'uniffy', specifier: '../../lint/uniffy-oxlint-plugin.mjs' }],
  rules: {
    curly: 'off',
    'no-void': 'off',
    'react/jsx-curly-brace-presence': 'off',
    'react/rules-of-hooks': 'error',
    'react/exhaustive-deps': 'warn',
    'react/react-compiler': 'warn',
    'uniffy/no-cdn-urls': 'error',
    'uniffy/no-expo-public-env': 'error',
    'uniffy/no-raw-error-display': 'error',
  },
  overrides: [
    {
      // Every RPC rides the shared transports in core/api (bounded timeouts, auth,
      // connectivity wiring). The sanctioned raw-fetch exceptions (asset reads,
      // local file:// URIs) carry an inline disable stating why.
      files: ['src/features/**/*.{ts,tsx}', 'src/shared/**/*.{ts,tsx}'],
      rules: {
        'no-restricted-globals': [
          'error',
          {
            name: 'fetch',
            message:
              'Use the shared transports/helpers in core/api instead of raw fetch. If this is genuinely not an RPC (asset read, local file URI), add a disable comment stating why.',
          },
        ],
      },
    },
    {
      files: ['src/shared/**/*.{ts,tsx}'],
      rules: layerRestriction(
        ['@features/**', '@/features/**', '@app/**', '@/app/**'],
        'Layer violation: shared/ must not import from features/ or app/. Promote the shared code down to shared/, core/, or theme/.',
      ),
    },
    {
      files: ['src/core/**/*.{ts,tsx}'],
      rules: layerRestriction(
        ['@features/**', '@/features/**', '@app/**', '@/app/**', '@shared/**', '@/shared/**'],
        'Layer violation: core/ is app infrastructure and must not import from features/, app/, or shared/.',
      ),
    },
    {
      files: ['src/theme/**/*.{ts,tsx}'],
      rules: layerRestriction(
        ['@features/**', '@/features/**', '@app/**', '@/app/**', '@shared/**', '@/shared/**', '@core/**', '@/core/**'],
        'Layer violation: theme/ holds pure design tokens and must not import from any other layer.',
      ),
    },
    {
      // Filenames are PascalCase (React component modules) or camelCase (everything else);
      // kebab-case is banned. app/ is exempt on purpose: Expo Router maps a file path to a URL,
      // so it owns its own naming (kebab URLs plus framework specials like +not-found, [id], (tabs)).
      files: [
        'src/features/**/*.{ts,tsx}',
        'src/shared/**/*.{ts,tsx}',
        'src/core/**/*.{ts,tsx}',
        'src/theme/**/*.{ts,tsx}',
      ],
      rules: {
        'unicorn/filename-case': [
          'error',
          {
            cases: { camelCase: true, pascalCase: true },
            ignore: [String.raw`\.(native|ios|android|web)\.`],
          },
        ],
      },
    },
  ],
});
