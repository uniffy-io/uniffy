export interface ImageGenerationMeta {
    prompt: string;
    params: Record<string, string>;
    fileUrn: string;
    model: string;
    cost: number | null;
}

/**
 * `tool_meta` crosses the wire as a JSON string inside the message metadata map;
 * anything that is not an image-generation payload yields `null`.
 */
export const parseImageMeta = (raw: unknown): ImageGenerationMeta | null => {
    let value: unknown = raw;
    if (typeof raw === 'string') {
        try {
            value = JSON.parse(raw);
        } catch {
            return null;
        }
    }
    if (typeof value !== 'object' || value === null) return null;
    const meta = value as Record<string, unknown>;
    if (meta.kind !== 'image_generation') return null;
    return {
        prompt: typeof meta.prompt === 'string' ? meta.prompt : '',
        params:
            typeof meta.params === 'object' && meta.params !== null
                ? (meta.params as Record<string, string>)
                : {},
        fileUrn: typeof meta.file_urn === 'string' ? meta.file_urn : '',
        model: typeof meta.model === 'string' ? meta.model : '',
        cost: typeof meta.cost === 'number' ? meta.cost : null,
    };
};
