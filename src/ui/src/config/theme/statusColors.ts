export type StatusType = "success" | "error" | "warning" | "info";

export const STATUS_HEX_COLORS: Record<StatusType, string> = {
  error: "#dc2626",
  success: "#22c55e",
  warning: "#eab308",
  info: "hsl(var(--primary))",
};

/** CSS custom property names, set on :root for stylesheet consumers. */
export const STATUS_CSS_VARS: Record<StatusType, string> = {
  error: "--status-error",
  success: "--status-success",
  warning: "--status-warning",
  info: "--status-info",
};
