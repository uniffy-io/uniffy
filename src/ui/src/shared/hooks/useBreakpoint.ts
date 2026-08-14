import { useSyncExternalStore } from "react";

// mobile: <768  tablet: 768-1023  desktop: >=1024  wide: >=1280
const BREAKPOINTS = {
  tablet: 768,
  desktop: 1024,
  wide: 1280,
} as const;

type Breakpoint = "mobile" | "tablet" | "desktop" | "wide";

interface BreakpointState {
  breakpoint: Breakpoint;
  isMobile: boolean;
  isTablet: boolean;
  isDesktop: boolean;
  isWide: boolean;
  /** true when viewport < 1024px (mobile or tablet) */
  isMobileOrTablet: boolean;
  /** true when viewport >= 768px (tablet or desktop) */
  isTabletOrDesktop: boolean;
}

function getBreakpointState(): BreakpointState {
  const width = window.innerWidth;

  const isMobile = width < BREAKPOINTS.tablet;
  const isTablet = width >= BREAKPOINTS.tablet && width < BREAKPOINTS.desktop;
  const isDesktop = width >= BREAKPOINTS.desktop;
  const isWide = width >= BREAKPOINTS.wide;

  let breakpoint: Breakpoint = "mobile";
  if (isWide) breakpoint = "wide";
  else if (isDesktop) breakpoint = "desktop";
  else if (isTablet) breakpoint = "tablet";

  return {
    breakpoint,
    isMobile,
    isTablet,
    isDesktop,
    isWide,
    isMobileOrTablet: isMobile || isTablet,
    isTabletOrDesktop: isTablet || isDesktop || isWide,
  };
}

let currentState =
  typeof window !== "undefined"
    ? getBreakpointState()
    : {
        breakpoint: "desktop" as Breakpoint,
        isMobile: false,
        isTablet: false,
        isDesktop: true,
        isWide: false,
        isMobileOrTablet: false,
        isTabletOrDesktop: true,
      };

const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);

  if (listeners.size === 1) {
    window.addEventListener("resize", handleResize);
  }

  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      window.removeEventListener("resize", handleResize);
    }
  };
}

function handleResize() {
  const next = getBreakpointState();
  // Notify only on threshold crossings so subscribers don't re-render every pixel.
  if (next.breakpoint !== currentState.breakpoint) {
    currentState = next;
    for (const listener of listeners) {
      listener();
    }
  }
}

function getSnapshot(): BreakpointState {
  return currentState;
}

function getServerSnapshot(): BreakpointState {
  return {
    breakpoint: "desktop",
    isMobile: false,
    isTablet: false,
    isDesktop: true,
    isWide: false,
    isMobileOrTablet: false,
    isTabletOrDesktop: true,
  };
}

export function useBreakpoint(): BreakpointState {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
