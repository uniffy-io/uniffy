const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');
// eslint-plugin-unicorn ships as ESM; require() returns the interop namespace,
// so the plugin object lives on .default.
const unicorn = require('eslint-plugin-unicorn').default ?? require('eslint-plugin-unicorn');

// Layering: app -> features -> shared -> core -> theme. Dependencies point one way.
// Lower layers must never import from higher ones, or the layering rots into a cycle.
const layerBoundaries = [
  {
    files: ["src/shared/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": ["error", { patterns: [
        { group: ["@features/*", "@/features/*", "@app/*", "@/app/*"],
          message: "Layer violation: shared/ must not import from features/ or app/. Promote the shared code down to shared/, core/, or theme/." },
      ] }],
    },
  },
  {
    files: ["src/core/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": ["error", { patterns: [
        { group: ["@features/*", "@/features/*", "@app/*", "@/app/*", "@shared/*", "@/shared/*"],
          message: "Layer violation: core/ is app infrastructure and must not import from features/, app/, or shared/." },
      ] }],
    },
  },
  {
    files: ["src/theme/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": ["error", { patterns: [
        { group: ["@features/*", "@/features/*", "@app/*", "@/app/*", "@shared/*", "@/shared/*", "@core/*", "@/core/*"],
          message: "Layer violation: theme/ holds pure design tokens and must not import from any other layer." },
      ] }],
    },
  },
];

// Filenames are PascalCase (React component modules) or camelCase (everything else);
// kebab-case is banned. app/ is exempt on purpose: Expo Router maps a file path to a URL,
// so it owns its own naming (kebab URLs plus framework specials like +not-found, [id], (tabs)).
const filenameCase = {
  files: [
    "src/features/**/*.{ts,tsx}",
    "src/shared/**/*.{ts,tsx}",
    "src/core/**/*.{ts,tsx}",
    "src/theme/**/*.{ts,tsx}",
  ],
  plugins: { unicorn },
  rules: {
    "unicorn/filename-case": ["error", {
      cases: { camelCase: true, pascalCase: true },
      ignore: [String.raw`\.(native|ios|android|web)\.`],
    }],
  },
};

module.exports = defineConfig([
  expoConfig,
  ...layerBoundaries,
  filenameCase,
  {
    ignores: ["dist/*"],
  }
]);
