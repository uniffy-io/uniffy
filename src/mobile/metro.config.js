const { getDefaultConfig } = require("expo/metro-config");
const path = require("path");

const projectRoot = __dirname;
const monorepoRoot = path.resolve(projectRoot, "../..");

const config = getDefaultConfig(projectRoot);

// Watch the whole monorepo so Metro's server root sits at the workspace root;
// in a pnpm monorepo this is what lets entry/module resolution find packages
// through the symlinked node_modules. (Covers the shared proto package too.)
config.watchFolders = [monorepoRoot];

// Resolve packages from both project and monorepo root
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, "node_modules"),
  path.resolve(monorepoRoot, "node_modules"),
];

// Generated proto files use ".js" extensions in imports (ES module convention).
// Tell Metro to resolve ".js" imports to ".ts" files as well.
config.resolver.sourceExts = [...(config.resolver.sourceExts || []), "mjs"];
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName.endsWith(".js")) {
    const tsName = moduleName.replace(/\.js$/, ".ts");
    try {
      return context.resolveRequest(context, tsName, platform);
    } catch {
      // Fall through to default resolution
    }
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
