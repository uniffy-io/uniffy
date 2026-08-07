/**
 * Turns a tool's JSON arguments or result into something a reader without a
 * terminal can parse: labelled facts and real prose instead of a brace-and-
 * backslash blob. Anything that is not JSON is already prose and passes through.
 */

// A single value is worth a lot of screen on a phone, so the long ones are cut
// and flagged rather than allowed to bury the rest of the conversation.
const VALUE_CHAR_LIMIT = 4000;
const INLINE_VALUE_CHARS = 80;

const ACRONYMS: Record<string, string> = {
  id: "ID",
  ids: "IDs",
  url: "URL",
  urls: "URLs",
  urn: "URN",
  urns: "URNs",
  api: "API",
  ai: "AI",
  utc: "UTC",
};

export interface PayloadField {
  label: string;
  value: string;
  /** Long or multi-line values read as a paragraph under their label. */
  block: boolean;
  truncated: boolean;
}

export type ReadablePayload =
  | { kind: "fields"; fields: PayloadField[] }
  | { kind: "text"; text: string; truncated: boolean }
  | { kind: "empty" };

function humanizeKey(key: string): string {
  return key
    .split("_")
    .map((word, idx) => {
      const acronym = ACRONYMS[word.toLowerCase()];
      if (acronym) return acronym;
      return idx === 0 ? word.charAt(0).toUpperCase() + word.slice(1) : word;
    })
    .join(" ");
}

/** Names an object by whatever it calls itself, so a list of them stays scannable. */
function summarizeItem(item: unknown): string {
  if (item === null || item === undefined) return "-";
  if (typeof item !== "object") return String(item);
  const record = item as Record<string, unknown>;
  for (const key of ["title", "name", "label", "display_name", "id"]) {
    const value = record[key];
    if (typeof value === "string" && value) return value;
  }
  return JSON.stringify(item);
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return "-";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "number") return String(value);
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    if (value.length === 0) return "None";
    const allPrimitive = value.every((item) => item === null || typeof item !== "object");
    return allPrimitive
      ? value.map((item) => String(item)).join(", ")
      : value.map((item) => `- ${summarizeItem(item)}`).join("\n");
  }
  return JSON.stringify(value, null, 2);
}

function clamp(text: string): { value: string; truncated: boolean } {
  return text.length > VALUE_CHAR_LIMIT
    ? { value: text.slice(0, VALUE_CHAR_LIMIT), truncated: true }
    : { value: text, truncated: false };
}

export function readableToolPayload(raw: string | undefined): ReadablePayload {
  const trimmed = raw?.trim();
  if (!trimmed || trimmed === "{}" || trimmed === "None" || trimmed === "null") {
    return { kind: "empty" };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    const { value, truncated } = clamp(trimmed);
    return { kind: "text", text: value, truncated };
  }

  if (parsed === null || typeof parsed !== "object") {
    const { value, truncated } = clamp(String(parsed));
    return { kind: "text", text: value, truncated };
  }

  if (Array.isArray(parsed)) {
    if (parsed.length === 0) return { kind: "empty" };
    const { value, truncated } = clamp(parsed.map((item) => `- ${summarizeItem(item)}`).join("\n"));
    return { kind: "text", text: value, truncated };
  }

  const entries = Object.entries(parsed as Record<string, unknown>);
  if (entries.length === 0) return { kind: "empty" };

  const fields = entries.map(([key, value]) => {
    const formatted = clamp(formatValue(value));
    return {
      label: humanizeKey(key),
      value: formatted.value,
      block: formatted.value.length > INLINE_VALUE_CHARS || formatted.value.includes("\n"),
      truncated: formatted.truncated,
    };
  });

  // Short facts first: a wall of prose in the middle hides the rest of them.
  return {
    kind: "fields",
    fields: [...fields.filter((f) => !f.block), ...fields.filter((f) => f.block)],
  };
}
