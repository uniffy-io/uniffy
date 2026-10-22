import { useEffect, useRef } from "react";
import { hslToHex } from "@/config/theme/accentColors";
import { Orbit, type OrbitPalette, type OrbitScene } from "@/components/orbit/engine";

function readPalette(): OrbitPalette {
  const root = document.documentElement;
  const style = getComputedStyle(root);
  const token = (name: string, fallback: string) =>
    hslToHex(style.getPropertyValue(name).trim(), fallback);
  return {
    ink: token("--foreground", "#111111"),
    muted: token("--muted-foreground", "#71717a"),
    primary: token("--primary", "#694aff"),
    dark: root.classList.contains("dark"),
    font: getComputedStyle(document.body).fontFamily || "ui-sans-serif, system-ui, sans-serif",
  };
}

/** Mounts an orbit on the returned canvas, hands it every scene, and keeps it on the current theme. */
export function useOrbit(scene: OrbitScene) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<Orbit | null>(null);
  const sceneRef = useRef(scene);

  useEffect(() => {
    sceneRef.current = scene;
    engineRef.current?.setScene(scene);
  }, [scene]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const host = canvas?.parentElement;
    if (!canvas || !host) return;

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const engine = new Orbit(canvas, readPalette(), reducedMotion);
    engineRef.current = engine;

    const measure = () => engine.resize(host.clientWidth, host.clientHeight);
    measure();
    engine.setScene(sceneRef.current);
    const resizeObserver = new ResizeObserver(measure);
    resizeObserver.observe(host);

    // ThemeProvider writes the scheme class and the accent onto the root element.
    const themeObserver = new MutationObserver(() => engine.setPalette(readPalette()));
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class", "style"],
    });

    const syncVisibility = () => {
      if (document.hidden) engine.stop();
      else engine.start();
    };
    syncVisibility();
    document.addEventListener("visibilitychange", syncVisibility);

    return () => {
      document.removeEventListener("visibilitychange", syncVisibility);
      themeObserver.disconnect();
      resizeObserver.disconnect();
      engine.stop();
      engineRef.current = null;
    };
  }, []);

  return canvasRef;
}
