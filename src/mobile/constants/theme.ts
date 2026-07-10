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

export type DomainColors = Record<DomainKey, string> & Record<`${DomainKey}Soft`, string>;

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
  pageBg: string;
  domains: DomainColors;
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

// Dark mode uses the pure brand primaries; light mode uses contrast-adjusted
// variants so every domain color holds >= 3:1 on white and the light page bg.
const DOMAINS_DARK: DomainColors = {
  notes: BRAND.pink,
  notesSoft: "rgba(253,126,234,0.14)",
  files: "#4a7dff",
  filesSoft: "rgba(74,125,255,0.14)",
  chat: BRAND.violet,
  chatSoft: "rgba(105,74,255,0.14)",
  calendar: BRAND.orange,
  calendarSoft: "rgba(255,85,0,0.14)",
  projects: BRAND.green,
  projectsSoft: "rgba(1,183,127,0.14)",
  agents: "#9b85ff",
  agentsSoft: "rgba(155,133,255,0.14)",
};

const DOMAINS_LIGHT: DomainColors = {
  notes: "#d63bbd",
  notesSoft: "rgba(214,59,189,0.10)",
  files: "#3568f5",
  filesSoft: "rgba(53,104,245,0.10)",
  chat: BRAND.violet,
  chatSoft: "rgba(105,74,255,0.10)",
  calendar: "#f04e00",
  calendarSoft: "rgba(240,78,0,0.10)",
  projects: "#019268",
  projectsSoft: "rgba(1,146,104,0.10)",
  agents: "#7a5af5",
  agentsSoft: "rgba(122,90,245,0.10)",
};

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
  pageBg: BRAND.midnight,
  domains: DOMAINS_DARK,
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
  pageBg: BRAND.white,
  domains: DOMAINS_LIGHT,
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

export const NAV_HEIGHT = 60;
export const BOTTOM_NAV_HEIGHT = 84;
