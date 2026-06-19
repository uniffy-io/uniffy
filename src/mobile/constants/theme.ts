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
};

export const DEFAULT_ACCENT_HSL = "217 91% 60%";

export const DARK: ThemeColors = {
  bg: "#1A1B1E",
  surface: "#25262B",
  surfaceHover: "#2C2E33",
  border: "#373A40",
  text: "#C1C2C5",
  textBright: "#E9ECEF",
  textDim: "#909296",
  accent: "#3b82f6",
  accentSoft: "rgba(59,130,246,0.12)",
  accentGlow: "rgba(59,130,246,0.25)",
  green: "#40C057",
  orange: "#FD7E14",
  blue: "#339AF0",
  red: "#FA5252",
  pink: "#E64980",
  yellow: "#FAB005",
  cyan: "#22B8CF",
  pageBg: "#0D0E11",
};

export const LIGHT: ThemeColors = {
  bg: "#FFFFFF",
  surface: "#F8F9FA",
  surfaceHover: "#F1F3F5",
  border: "#DEE2E6",
  text: "#495057",
  textBright: "#212529",
  textDim: "#868E96",
  accent: "#0b64f4",
  accentSoft: "rgba(11,100,244,0.08)",
  accentGlow: "rgba(11,100,244,0.15)",
  green: "#2F9E44",
  orange: "#E8590C",
  blue: "#1C7ED6",
  red: "#E03131",
  pink: "#C2255C",
  yellow: "#F08C00",
  cyan: "#1098AD",
  pageBg: "#F1F3F5",
};

export const DOMAIN_COLORS = {
  notes: "#3b82f6",
  notesSoft: "rgba(59,130,246,0.12)",
  files: "#3b82f6",
  filesSoft: "rgba(59,130,246,0.12)",
  chat: "#3b82f6",
  chatSoft: "rgba(59,130,246,0.12)",
  calendar: "#3b82f6",
  calendarSoft: "rgba(59,130,246,0.12)",
  projects: "#3b82f6",
  projectsSoft: "rgba(59,130,246,0.12)",
};

export const FILE_COLORS: Record<string, string> = {
  pdf: "#FA5252",
  pptx: "#FD7E14",
  png: "#E64980",
  jpg: "#E64980",
  xlsx: "#40C057",
  mp4: "#22B8CF",
  zip: "#909296",
  fig: "#7C5CFC",
  doc: "#339AF0",
  docx: "#339AF0",
  default: "#909296",
};

export const CATEGORY_COLORS = [
  { hex: "#3B82F6", label: "Blue" },
  { hex: "#8B5CF6", label: "Purple" },
  { hex: "#10B981", label: "Green" },
  { hex: "#EF4444", label: "Red" },
  { hex: "#F59E0B", label: "Orange" },
  { hex: "#EC4899", label: "Pink" },
  { hex: "#14B8A6", label: "Teal" },
  { hex: "#6366F1", label: "Indigo" },
  { hex: "#64748B", label: "Gray" },
];

export const NAV_HEIGHT = 60;
export const BOTTOM_NAV_HEIGHT = 84;
