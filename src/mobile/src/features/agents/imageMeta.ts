export interface ImageGenerationMeta {
  prompt: string;
  params: Record<string, string>;
  fileUrn: string;
  model: string;
  cost: number | null;
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * `tool_meta` crosses the wire as a JSON string inside the message metadata map;
 * anything that is not an image-generation payload yields `null`.
 */
export function parseImageMeta(raw: unknown): ImageGenerationMeta | null {
  let value: unknown = raw;
  if (typeof raw === "string") {
    try {
      value = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!isPlainObject(value)) return null;
  if (value.kind !== "image_generation") return null;
  return {
    prompt: typeof value.prompt === "string" ? value.prompt : "",
    params: isPlainObject(value.params) ? (value.params as Record<string, string>) : {},
    fileUrn: typeof value.file_urn === "string" ? value.file_urn : "",
    model: typeof value.model === "string" ? value.model : "",
    cost: typeof value.cost === "number" ? value.cost : null,
  };
}

export function formatImageCost(value: number): string {
  if (!Number.isFinite(value)) return "";
  return `~$${value.toFixed(value < 0.01 ? 4 : 2)}`;
}
