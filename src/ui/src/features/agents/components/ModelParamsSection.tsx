import { useMemo, useState } from 'react';
import { ArrowCounterClockwise, CaretRight, Faders } from '@phosphor-icons/react';
import { cn } from '@/shared/utils/cn';
import { Select, type SelectOption } from '@/components/ui/select';
import { ToggleSwitch } from '@/components/ui/toggle-switch';
import {
    parseModelParamsSchema,
    type BooleanParamSpec,
    type EnumParamSpec,
    type ModelParamValues,
    type NumberParamSpec,
    type ParamSpec,
    type ParamValue,
} from '@/features/agents/utils/modelParamsSchema';

const PARAM_LABELS: Record<string, string> = {
    temperature: 'Temperature',
    top_p: 'Top P',
    top_k: 'Top K',
    max_tokens: 'Max tokens',
    reasoning_effort: 'Reasoning effort',
};

const paramLabel = (key: string): string => {
    if (PARAM_LABELS[key]) return PARAM_LABELS[key];
    const words = key.replace(/_/g, ' ');
    return words.charAt(0).toUpperCase() + words.slice(1);
};

const scalarValue = (
    value: ParamValue | Record<string, ParamValue> | undefined,
): ParamValue | undefined => (typeof value === 'object' ? undefined : value);

const enumOptionLabel = (key: string, member: string, members: string[]): string => {
    if (key === 'reasoning_effort') {
        const plainOnOff = members.length === 2 && members.includes('off') && members.includes('on');
        if (plainOnOff) return member === 'off' ? 'Off' : 'On';
        if (member === 'off') return 'Off (provider default)';
    }
    return member.charAt(0).toUpperCase() + member.slice(1);
};

function ParamRow({
    label,
    isSet,
    disabled,
    onReset,
    children,
}: {
    label: string;
    isSet: boolean;
    disabled: boolean;
    onReset: () => void;
    children: React.ReactNode;
}) {
    return (
        <div>
            <div className="flex items-center justify-between mb-1.5">
                <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                    {label}
                </span>
                {isSet ? (
                    <button
                        type="button"
                        onClick={onReset}
                        disabled={disabled}
                        title="Reset to provider default"
                        className={cn(
                            'inline-flex items-center gap-1 text-[10px] text-muted-foreground',
                            'hover:text-foreground transition-colors',
                            disabled && 'opacity-50 cursor-not-allowed',
                        )}
                    >
                        <ArrowCounterClockwise size={11} weight="bold" />
                        Reset
                    </button>
                ) : (
                    <span className="text-[10px] text-muted-foreground/70">Provider default</span>
                )}
            </div>
            {children}
        </div>
    );
}

function NumberParamControl({
    paramKey,
    spec,
    value,
    disabled,
    onCommit,
    onReset,
}: {
    paramKey: string;
    spec: NumberParamSpec;
    value: number | undefined;
    disabled: boolean;
    onCommit: (value: number) => void;
    onReset: () => void;
}) {
    const [editState, setEditState] = useState<{ tracked: number | undefined; text: string | null }>({
        tracked: value,
        text: null,
    });
    // Keep an in-flight edit visible until the committed value prop catches up,
    // otherwise the control snaps back while the update RPC is pending.
    if (editState.tracked !== value) {
        setEditState({ tracked: value, text: null });
    }

    const step = spec.step ?? (spec.type === 'integer' ? 1 : 0.01);
    const hasSlider = spec.minimum !== undefined && spec.maximum !== undefined;

    const draftText = editState.text?.trim();
    const draftNumber = draftText ? Number(draftText) : undefined;
    const draftValid = draftNumber !== undefined && Number.isFinite(draftNumber);
    const effective = draftValid ? draftNumber : (editState.text === null ? value : undefined);
    const sliderValue = effective ?? spec.default ?? spec.minimum ?? 0;

    const commitText = (text: string) => {
        if (text.trim() === '') {
            if (value !== undefined) onReset();
            setEditState({ tracked: value, text: null });
            return;
        }
        let next = Number(text);
        if (!Number.isFinite(next)) {
            setEditState({ tracked: value, text: null });
            return;
        }
        if (spec.type === 'integer') next = Math.round(next);
        if (spec.minimum !== undefined) next = Math.max(spec.minimum, next);
        if (spec.maximum !== undefined) next = Math.min(spec.maximum, next);
        if (next === value) {
            setEditState({ tracked: value, text: null });
            return;
        }
        onCommit(next);
    };

    return (
        <ParamRow
            label={paramLabel(paramKey)}
            isSet={value !== undefined}
            disabled={disabled}
            onReset={onReset}
        >
            <div className="flex items-center gap-3">
                {hasSlider && (
                    <input
                        type="range"
                        min={spec.minimum}
                        max={spec.maximum}
                        step={step}
                        value={sliderValue}
                        disabled={disabled}
                        onChange={(e) => setEditState({ tracked: value, text: e.target.value })}
                        onPointerUp={() => {
                            if (editState.text !== null) commitText(editState.text);
                        }}
                        onBlur={() => {
                            if (editState.text !== null) commitText(editState.text);
                        }}
                        className={cn(
                            'flex-1 accent-primary',
                            effective === undefined && 'opacity-60',
                            disabled && 'opacity-50 cursor-not-allowed',
                        )}
                    />
                )}
                <input
                    type="number"
                    min={spec.minimum}
                    max={spec.maximum}
                    step={step}
                    value={editState.text ?? (value !== undefined ? String(value) : '')}
                    placeholder={spec.default !== undefined ? String(spec.default) : 'auto'}
                    disabled={disabled}
                    onChange={(e) => setEditState({ tracked: value, text: e.target.value })}
                    onBlur={(e) => commitText(e.target.value)}
                    onKeyDown={(e) => {
                        if (e.key === 'Enter') commitText(e.currentTarget.value);
                    }}
                    className={cn(
                        hasSlider ? 'w-24' : 'w-full',
                        'bg-background border border-border rounded-md px-2 py-1 text-xs text-foreground tabular-nums',
                        'focus:outline-none focus:ring-1 focus:ring-ring focus:border-ring transition-all',
                        'placeholder:text-muted-foreground',
                        disabled && 'opacity-50 cursor-not-allowed',
                    )}
                />
            </div>
        </ParamRow>
    );
}

function EnumParamControl({
    paramKey,
    spec,
    value,
    disabled,
    onCommit,
    onReset,
}: {
    paramKey: string;
    spec: EnumParamSpec;
    value: string | undefined;
    disabled: boolean;
    onCommit: (value: string) => void;
    onReset: () => void;
}) {
    const options: SelectOption<string>[] = spec.enum.map((member) => ({
        value: member,
        label: enumOptionLabel(paramKey, member, spec.enum),
    }));
    const placeholder = spec.default !== undefined
        ? enumOptionLabel(paramKey, spec.default, spec.enum)
        : 'Provider default';
    return (
        <ParamRow
            label={paramLabel(paramKey)}
            isSet={value !== undefined}
            disabled={disabled}
            onReset={onReset}
        >
            <Select
                value={value}
                onChange={onCommit}
                options={options}
                placeholder={placeholder}
                disabled={disabled}
                size="sm"
                className="w-full"
                triggerClassName="w-full"
            />
        </ParamRow>
    );
}

function BooleanParamControl({
    paramKey,
    spec,
    value,
    disabled,
    onCommit,
    onReset,
}: {
    paramKey: string;
    spec: BooleanParamSpec;
    value: boolean | undefined;
    disabled: boolean;
    onCommit: (value: boolean) => void;
    onReset: () => void;
}) {
    return (
        <ParamRow
            label={paramLabel(paramKey)}
            isSet={value !== undefined}
            disabled={disabled}
            onReset={onReset}
        >
            <ToggleSwitch
                enabled={value ?? spec.default ?? false}
                onChange={onCommit}
                disabled={disabled}
                size="sm"
            />
        </ParamRow>
    );
}

function ParamControl({
    paramKey,
    spec,
    value,
    disabled,
    onCommit,
    onReset,
}: {
    paramKey: string;
    spec: ParamSpec;
    value: ParamValue | undefined;
    disabled: boolean;
    onCommit: (value: ParamValue) => void;
    onReset: () => void;
}) {
    switch (spec.type) {
        case 'number':
        case 'integer':
            return (
                <NumberParamControl
                    paramKey={paramKey}
                    spec={spec}
                    value={typeof value === 'number' ? value : undefined}
                    disabled={disabled}
                    onCommit={onCommit}
                    onReset={onReset}
                />
            );
        case 'enum':
            return (
                <EnumParamControl
                    paramKey={paramKey}
                    spec={spec}
                    value={typeof value === 'string' ? value : undefined}
                    disabled={disabled}
                    onCommit={onCommit}
                    onReset={onReset}
                />
            );
        case 'boolean':
            return (
                <BooleanParamControl
                    paramKey={paramKey}
                    spec={spec}
                    value={typeof value === 'boolean' ? value : undefined}
                    disabled={disabled}
                    onCommit={onCommit}
                    onReset={onReset}
                />
            );
    }
}

export function ModelParamsSection({
    schemaJson,
    values,
    onChange,
    disabled = false,
}: {
    schemaJson: string;
    values: ModelParamValues;
    onChange: (values: ModelParamValues) => void;
    disabled?: boolean;
}) {
    const [advancedOpen, setAdvancedOpen] = useState(false);
    const schema = useMemo(() => parseModelParamsSchema(schemaJson), [schemaJson]);

    if (!schema) return null;

    const paramKeys = Object.keys(schema.params);
    const orderedKeys = paramKeys.includes('reasoning_effort')
        ? ['reasoning_effort', ...paramKeys.filter((k) => k !== 'reasoning_effort')]
        : paramKeys;
    const providerOptionKeys = Object.keys(schema.providerOptions);
    const providerOptionValues = values.provider_options ?? {};
    const hasAnyValue = Object.keys(values).length > 0;

    const setParam = (key: string, value: ParamValue) => {
        onChange({ ...values, [key]: value });
    };
    const resetParam = (key: string) => {
        const next = { ...values };
        delete next[key];
        onChange(next);
    };
    const setProviderOption = (key: string, value: ParamValue) => {
        onChange({ ...values, provider_options: { ...providerOptionValues, [key]: value } });
    };
    const resetProviderOption = (key: string) => {
        const nested = { ...providerOptionValues };
        delete nested[key];
        const next = { ...values };
        if (Object.keys(nested).length > 0) {
            next.provider_options = nested;
        } else {
            delete next.provider_options;
        }
        onChange(next);
    };

    return (
        <div className="pt-4 border-t border-border space-y-4">
            <div className="flex items-center justify-between">
                <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-foreground uppercase tracking-wider">
                    <Faders size={14} weight="duotone" className="text-muted-foreground" />
                    Model Parameters
                </span>
                {hasAnyValue && (
                    <button
                        type="button"
                        onClick={() => onChange({})}
                        disabled={disabled}
                        className={cn(
                            'inline-flex items-center gap-1 text-[10px] text-muted-foreground',
                            'hover:text-foreground transition-colors',
                            disabled && 'opacity-50 cursor-not-allowed',
                        )}
                    >
                        <ArrowCounterClockwise size={11} weight="bold" />
                        Reset all
                    </button>
                )}
            </div>
            {orderedKeys.map((key) => (
                <ParamControl
                    key={key}
                    paramKey={key}
                    spec={schema.params[key]}
                    value={scalarValue(values[key])}
                    disabled={disabled}
                    onCommit={(value) => setParam(key, value)}
                    onReset={() => resetParam(key)}
                />
            ))}
            {providerOptionKeys.length > 0 && (
                <div>
                    <button
                        type="button"
                        onClick={() => setAdvancedOpen((open) => !open)}
                        className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
                    >
                        <CaretRight
                            size={12}
                            weight="bold"
                            className={cn('transition-transform duration-150', advancedOpen && 'rotate-90')}
                        />
                        Advanced (provider-specific)
                    </button>
                    {advancedOpen && (
                        <div className="mt-3 space-y-4">
                            {providerOptionKeys.map((key) => (
                                <ParamControl
                                    key={key}
                                    paramKey={key}
                                    spec={schema.providerOptions[key]}
                                    value={providerOptionValues[key]}
                                    disabled={disabled}
                                    onCommit={(value) => setProviderOption(key, value)}
                                    onReset={() => resetProviderOption(key)}
                                />
                            ))}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
