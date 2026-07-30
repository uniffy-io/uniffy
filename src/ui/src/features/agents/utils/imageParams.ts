import type { ModelParamValues } from '@/features/agents/utils/modelParamsSchema';

/** Per-image USD estimates keyed `"{aspect_ratio}|{resolution}|{quality}"`. */
export type ImagePriceEstimates = Record<string, string>;

export const parseImagePriceEstimates = (json: string): ImagePriceEstimates => {
    if (!json) return {};
    try {
        const raw: unknown = JSON.parse(json);
        return typeof raw === 'object' && raw !== null ? (raw as ImagePriceEstimates) : {};
    } catch {
        return {};
    }
};

const asString = (value: unknown, fallback: string): string =>
    typeof value === 'string' ? value : fallback;

/**
 * Price for the current selection, or `null` when the catalog publishes no rate
 * for it. Unset knobs fall back to the provider defaults the backend applies.
 */
export const estimateImageCost = (
    estimates: ImagePriceEstimates,
    values: ModelParamValues,
    defaults: Partial<Record<string, string>> = {},
): string | null => {
    if (Object.keys(estimates).length === 0) return null;
    const aspectRatio = asString(values.aspect_ratio, defaults.aspect_ratio ?? '1:1');
    const resolution = asString(values.resolution, defaults.resolution ?? '1K');
    const quality = asString(values.quality, defaults.quality ?? 'auto');
    return estimates[`${aspectRatio}|${resolution}|${quality}`] ?? null;
};

/** `"0.211000"` -> `"~$0.21"`; sub-cent rates keep enough digits to be readable. */
export const formatImageCost = (raw: string): string => {
    const value = Number(raw);
    if (!Number.isFinite(value)) return '';
    const digits = value < 0.01 ? 4 : 2;
    return `~$${value.toFixed(digits)}`;
};
