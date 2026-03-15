const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);

// Generated proto files use ".js" extensions in imports (ES module convention).
// Tell Metro to resolve ".js" imports to ".ts" files as well.
config.resolver.sourceExts = [...(config.resolver.sourceExts || []), "mjs"];
config.resolver.resolveRequest = (context, moduleName, platform) => {
  // Rewrite ".js" imports to ".ts" when the .js file doesn't exist
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
