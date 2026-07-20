export interface NumberParamSpec {
    type: 'number' | 'integer';
    minimum?: number;
    maximum?: number;
    step?: number;
    default?: number;
}

export interface EnumParamSpec {
    type: 'enum';
    enum: string[];
    default?: string;
}

export interface BooleanParamSpec {
    type: 'boolean';
    default?: boolean;
}

export type ParamSpec = NumberParamSpec | EnumParamSpec | BooleanParamSpec;

export type ParamValue = number | string | boolean;

export interface ModelParamValues {
    [key: string]: ParamValue | Record<string, ParamValue> | undefined;
    provider_options?: Record<string, ParamValue>;
}

export interface ModelParamsSchema {
    params: Record<string, ParamSpec>;
    providerOptions: Record<string, ParamSpec>;
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
    typeof value === 'object' && value !== null && !Array.isArray(value);

const parseSpec = (raw: unknown): ParamSpec | null => {
    if (!isPlainObject(raw)) return null;
    if (raw.type === 'number' || raw.type === 'integer') {
        return {
            type: raw.type,
            minimum: typeof raw.minimum === 'number' ? raw.minimum : undefined,
            maximum: typeof raw.maximum === 'number' ? raw.maximum : undefined,
            step: typeof raw.step === 'number' ? raw.step : undefined,
            default: typeof raw.default === 'number' ? raw.default : undefined,
        };
    }
    if (raw.type === 'enum' && Array.isArray(raw.enum)) {
        const members = raw.enum.filter((m): m is string => typeof m === 'string');
        if (members.length === 0) return null;
        return {
            type: 'enum',
            enum: members,
            default: typeof raw.default === 'string' ? raw.default : undefined,
        };
    }
    if (raw.type === 'boolean') {
        return {
            type: 'boolean',
            default: typeof raw.default === 'boolean' ? raw.default : undefined,
        };
    }
    return null;
};

export const parseModelParamsSchema = (schemaJson: string): ModelParamsSchema | null => {
    if (!schemaJson) return null;
    let raw: unknown;
    try {
        raw = JSON.parse(schemaJson);
    } catch {
        return null;
    }
    if (!isPlainObject(raw)) return null;
    const params: Record<string, ParamSpec> = {};
    const providerOptions: Record<string, ParamSpec> = {};
    for (const [key, value] of Object.entries(raw)) {
        if (key === 'provider_options') {
            if (!isPlainObject(value)) continue;
            for (const [optKey, optRaw] of Object.entries(value)) {
                const spec = parseSpec(optRaw);
                if (spec) providerOptions[optKey] = spec;
            }
            continue;
        }
        const spec = parseSpec(value);
        if (spec) params[key] = spec;
    }
    if (Object.keys(params).length === 0 && Object.keys(providerOptions).length === 0) {
        return null;
    }
    return { params, providerOptions };
};

export const parseModelParamValues = (json: string): ModelParamValues => {
    if (!json) return {};
    let raw: unknown;
    try {
        raw = JSON.parse(json);
    } catch {
        return {};
    }
    return isPlainObject(raw) ? (raw as ModelParamValues) : {};
};

const valueValidates = (spec: ParamSpec, value: unknown): value is ParamValue => {
    switch (spec.type) {
        case 'number':
        case 'integer': {
            if (typeof value !== 'number' || !Number.isFinite(value)) return false;
            if (spec.type === 'integer' && !Number.isInteger(value)) return false;
            if (spec.minimum !== undefined && value < spec.minimum) return false;
            if (spec.maximum !== undefined && value > spec.maximum) return false;
            return true;
        }
        case 'enum':
            return typeof value === 'string' && spec.enum.includes(value);
        case 'boolean':
            return typeof value === 'boolean';
    }
};

export const stripInvalidParams = (
    schema: ModelParamsSchema | null,
    values: ModelParamValues,
): ModelParamValues => {
    if (!schema) return {};
    const result: ModelParamValues = {};
    for (const [key, value] of Object.entries(values)) {
        if (key === 'provider_options') continue;
        const spec = schema.params[key];
        if (spec && valueValidates(spec, value)) result[key] = value;
    }
    const nested = values.provider_options;
    if (isPlainObject(nested)) {
        const kept: Record<string, ParamValue> = {};
        for (const [key, value] of Object.entries(nested)) {
            const spec = schema.providerOptions[key];
            if (spec && valueValidates(spec, value)) kept[key] = value;
        }
        if (Object.keys(kept).length > 0) result.provider_options = kept;
    }
    return result;
};
