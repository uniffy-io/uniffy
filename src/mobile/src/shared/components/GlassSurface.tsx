import React from "react";
import { Platform, TurboModuleRegistry, View } from "react-native";
import type { ColorValue, StyleProp, ViewStyle } from "react-native";
import { BlurView } from "expo-blur";

type LiquidGlassLib = typeof import("@callstack/liquid-glass");

// Same stale-client guard as livekit.native.ts: Metro can serve a newer JS
// bundle to a dev client compiled without this native module, and the library
// calls TurboModuleRegistry.getEnforcing at import time, which would crash the
// whole bundle. Probe non-enforcing first and degrade to the blur fallback.
const nativeGlassPresent =
  Platform.OS === "ios" && TurboModuleRegistry.get("NativeLiquidGlassModule") != null;

let lib: LiquidGlassLib | null = null;
function loadLiquidGlass(): LiquidGlassLib | null {
  if (!nativeGlassPresent) return null;
  if (!lib) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    lib = require("@callstack/liquid-glass") as LiquidGlassLib;
  }
  return lib;
}

type GlassSurfaceProps = {
  style?: StyleProp<ViewStyle>;
  tintColor?: ColorValue;
  interactive?: boolean;
  isDark: boolean;
  blurIntensity: number;
  solidColor: ColorValue;
};

// Background surface with graceful degradation: Liquid Glass on iOS 26+,
// system-chrome blur on older iOS (or a stale dev client), a solid fill on
// Android and web.
export function GlassSurface({
  style,
  tintColor,
  interactive = false,
  isDark,
  blurIntensity,
  solidColor,
}: GlassSurfaceProps) {
  const glass = loadLiquidGlass();
  if (glass?.isLiquidGlassSupported) {
    return (
      <glass.LiquidGlassView
        style={style}
        effect="regular"
        interactive={interactive}
        tintColor={tintColor}
        colorScheme={isDark ? "dark" : "light"}
      />
    );
  }
  if (Platform.OS === "ios") {
    return (
      <BlurView
        style={style}
        intensity={blurIntensity}
        tint={isDark ? "systemChromeMaterialDark" : "systemChromeMaterialLight"}
      />
    );
  }
  return <View style={[style, { backgroundColor: solidColor }]} />;
}
