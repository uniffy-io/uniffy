const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

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

module.exports = defineConfig([
  expoConfig,
  ...layerBoundaries,
  {
    ignores: ["dist/*"],
  }
]);
