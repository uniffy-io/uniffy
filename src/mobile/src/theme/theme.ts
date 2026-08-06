// Brand palette from docs/brand/palette.md (2026 brand book).
export const BRAND = {
  violet: "#694aff",
  orange: "#ff5500",
  green: "#01b77f",
  pink: "#fd7eea",
  logoOrange: "#fb6127",
  midnight: "#0d111e",
  white: "#eeeeee",
} as const;

export type DomainKey = "notes" | "files" | "chat" | "calendar" | "projects" | "agents";

export type ThemeColors = {
  bg: string;
  surface: string;
  surfaceHover: string;
  border: string;
  text: string;
  textBright: string;
  textDim: string;
  accent: string;
  accentSoft: string;
  accentGlow: string;
  green: string;
  orange: string;
  blue: string;
  red: string;
  pink: string;
  yellow: string;
  cyan: string;
  /** Groups, wherever they sit beside people (pickers, share rows, avatars). */
  group: string;
  pageBg: string;
};

// Exact HSL of BRAND.violet #694aff.
export const DEFAULT_ACCENT_HSL = "250.3 100% 64.5%";

// Accent choices offered in Appearance. Stored values outside this list are
// ignored at load time so accents from retired palettes cannot pin a stale
// color on the device or profile.
export const ACCENT_PRESETS: { name: string; hsl: string }[] = [
  { name: "Violet", hsl: DEFAULT_ACCENT_HSL },
  { name: "Orange", hsl: "20 100% 50%" },
  { name: "Green", hsl: "161.5 98.9% 36.1%" },
  { name: "Pink", hsl: "309 96.9% 74.3%" },
  { name: "Blue", hsl: "223.1 100% 64.5%" },
  { name: "Teal", hsl: "174 72% 40%" },
  { name: "Amber", hsl: "38 92% 50%" },
  { name: "Red", hsl: "0 84.2% 60.2%" },
];

export const DARK: ThemeColors = {
  bg: "#12172a",
  surface: "#1a2138",
  surfaceHover: "#222a46",
  border: "#2d3654",
  text: "#b8bfd4",
  textBright: "#eaedf6",
  textDim: "#808aa8",
  accent: BRAND.violet,
  accentSoft: "rgba(105,74,255,0.14)",
  accentGlow: "rgba(105,74,255,0.30)",
  green: BRAND.green,
  orange: "#ff8033",
  blue: "#4a7dff",
  red: "#FA5252",
  pink: BRAND.pink,
  yellow: "#FAB005",
  cyan: "#22B8CF",
  group: "#8b5cf6",
  pageBg: BRAND.midnight,
};

export const LIGHT: ThemeColors = {
  bg: "#FFFFFF",
  surface: "#f6f7fa",
  surfaceHover: "#eef0f5",
  border: "#dcdfe8",
  text: "#454c63",
  textBright: "#14192b",
  textDim: "#7d849c",
  accent: BRAND.violet,
  accentSoft: "rgba(105,74,255,0.08)",
  accentGlow: "rgba(105,74,255,0.16)",
  green: "#019268",
  orange: "#e8590c",
  blue: "#3568f5",
  red: "#E03131",
  pink: "#d63bbd",
  yellow: "#F08C00",
  cyan: "#1098AD",
  group: "#7c3aed",
  pageBg: BRAND.white,
};

export const FILE_COLORS: Record<string, string> = {
  pdf: "#FA5252",
  pptx: "#ff8033",
  png: "#d63bbd",
  jpg: "#d63bbd",
  xlsx: "#01b77f",
  mp4: "#22B8CF",
  zip: "#808aa8",
  fig: "#694aff",
  doc: "#4a7dff",
  docx: "#4a7dff",
  default: "#808aa8",
};

export const CATEGORY_COLORS = [
  { hex: "#694aff", label: "Violet" },
  { hex: "#ff5500", label: "Orange" },
  { hex: "#01b77f", label: "Green" },
  { hex: "#fd7eea", label: "Pink" },
  { hex: "#4a7dff", label: "Blue" },
  { hex: "#EF4444", label: "Red" },
  { hex: "#F59E0B", label: "Amber" },
  { hex: "#14B8A6", label: "Teal" },
  { hex: "#64748B", label: "Gray" },
];

/**
 * Swatches offered when naming a board column. Deliberately matches the web
 * status palette so the same status reads the same colour on both clients.
 */
export const STATUS_PALETTE = [
  "#6b7280",
  "#3b82f6",
  "#22c55e",
  "#f59e0b",
  "#ef4444",
  "#8b5cf6",
  "#ec4899",
  "#06b6d4",
  "#f97316",
  "#14b8a6",
];

export const NAV_HEIGHT = 60;
export const BOTTOM_NAV_HEIGHT = 84;
