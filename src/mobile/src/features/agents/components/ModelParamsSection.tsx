import React, { useMemo, useState } from "react";
import { View, Text, TextInput, TouchableOpacity, Switch, StyleSheet } from "react-native";
import { ArrowCounterClockwise, CaretRight, Minus, Plus } from "phosphor-react-native";
import type { ThemeColors } from "@theme/theme";
import { FONT } from "@theme/typography";
import {
  parseModelParamsSchema,
  type BooleanParamSpec,
  type EnumParamSpec,
  type ModelParamValues,
  type NumberParamSpec,
  type ParamSpec,
  type ParamValue,
} from "@features/agents/modelParamsSchema";

const PARAM_LABELS: Record<string, string> = {
  temperature: "Temperature",
  top_p: "Top P",
  top_k: "Top K",
  max_tokens: "Max tokens",
  reasoning_effort: "Reasoning effort",
  aspect_ratio: "Aspect ratio",
  resolution: "Resolution",
  quality: "Quality",
  background: "Background",
  output_format: "File format",
  moderation: "Moderation",
  person_generation: "People in images",
};

const PARAM_HELP: Record<string, string> = {
  temperature: "Sampling randomness. Lower is more focused, higher is more varied.",
  top_p: "Limits sampling to the most likely tokens that add up to this probability.",
  top_k: "Limits sampling to the K most likely tokens.",
  max_tokens: "Caps the length of the reply, in output tokens. Not a reasoning budget.",
  reasoning_effort: "How much the model thinks before answering.",
  parallel_tool_calls: "Lets the model request several tool calls in a single turn.",
  aspect_ratio: "Shape of generated images.",
  resolution: "Output size. Higher tiers cost several times more per image.",
  quality: "Rendering effort. High costs substantially more than low.",
  background: "Transparent produces a cut-out with no backdrop.",
  output_format: "File type the image is stored as.",
  moderation: "Content-filter strictness the provider applies.",
  person_generation: "Whether the provider may render people.",
};

function paramLabel(key: string): string {
  if (PARAM_LABELS[key]) return PARAM_LABELS[key];
  const words = key.replace(/_/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function enumOptionLabel(key: string, member: string, members: string[]): string {
  if (key === "reasoning_effort") {
    const plainOnOff = members.length === 2 && members.includes("off") && members.includes("on");
    if (plainOnOff) return member === "off" ? "Off" : "On";
  }
  return member.charAt(0).toUpperCase() + member.slice(1);
}

const scalarValue = (
  value: ParamValue | Record<string, ParamValue> | undefined,
): ParamValue | undefined => (typeof value === "object" ? undefined : value);

/**
 * Retarget a spec's `default` at the value this form inherits when a knob is
 * unset, so an override form shows the layer it sits on (the agent's own
 * setting) rather than the provider default the builder already moved away from.
 */
function withInherited(spec: ParamSpec, inherited: ParamValue | undefined): ParamSpec {
  if (inherited === undefined) return spec;
  switch (spec.type) {
    case "enum":
      return typeof inherited === "string" && spec.enum.includes(inherited)
        ? { ...spec, default: inherited }
        : spec;
    case "boolean":
      return typeof inherited === "boolean" ? { ...spec, default: inherited } : spec;
    default:
      return typeof inherited === "number" ? { ...spec, default: inherited } : spec;
  }
}

function ParamRow({
  T,
  label,
  help,
  isSet,
  disabled,
  onReset,
  children,
}: {
  T: ThemeColors;
  label: string;
  help?: string;
  isSet: boolean;
  disabled: boolean;
  onReset: () => void;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.paramRow}>
      <View style={styles.paramHead}>
        <Text style={[styles.paramLabel, { color: T.textDim }]}>{label}</Text>
        {isSet ? (
          <TouchableOpacity
            onPress={onReset}
            disabled={disabled}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            style={styles.resetChip}
          >
            <ArrowCounterClockwise size={11} color={T.accent} weight="bold" />
            <Text style={[styles.resetText, { color: T.accent }]}>Reset</Text>
          </TouchableOpacity>
        ) : (
          <Text style={[styles.inheritTag, { color: T.textDim }]}>Default</Text>
        )}
      </View>
      {children}
      {help ? <Text style={[styles.paramHelp, { color: T.textDim }]}>{help}</Text> : null}
    </View>
  );
}

function NumberParamControl({
  T,
  paramKey,
  spec,
  value,
  disabled,
  onCommit,
  onReset,
}: {
  T: ThemeColors;
  paramKey: string;
  spec: NumberParamSpec;
  value: number | undefined;
  disabled: boolean;
  onCommit: (value: number) => void;
  onReset: () => void;
}) {
  // Held while the field has focus so a half-typed "0." is not clamped away
  // mid-keystroke; committed on blur.
  const [draft, setDraft] = useState<string | null>(null);
  const step = spec.step ?? (spec.type === "integer" ? 1 : 0.1);

  const clamp = (n: number): number => {
    let next = spec.type === "integer" ? Math.round(n) : n;
    if (spec.minimum !== undefined) next = Math.max(spec.minimum, next);
    if (spec.maximum !== undefined) next = Math.min(spec.maximum, next);
    // Float steps accumulate representation error; two decimals covers every
    // knob the catalog declares.
    return spec.type === "integer" ? next : Math.round(next * 100) / 100;
  };

  const commit = (text: string) => {
    setDraft(null);
    if (text.trim() === "") {
      if (value !== undefined) onReset();
      return;
    }
    const parsed = Number(text);
    if (!Number.isFinite(parsed)) return;
    const next = clamp(parsed);
    if (next !== value) onCommit(next);
  };

  const nudge = (direction: 1 | -1) => {
    const base = value ?? spec.default ?? spec.minimum ?? 0;
    const next = clamp(base + direction * step);
    if (next !== value) onCommit(next);
  };

  return (
    <ParamRow
      T={T}
      label={paramLabel(paramKey)}
      help={PARAM_HELP[paramKey]}
      isSet={value !== undefined}
      disabled={disabled}
      onReset={onReset}
    >
      <View style={styles.numberRow}>
        <TouchableOpacity
          style={[styles.stepper, { backgroundColor: T.bg, borderColor: T.border }]}
          onPress={() => nudge(-1)}
          disabled={disabled}
          activeOpacity={0.7}
        >
          <Minus size={14} color={T.text} weight="bold" />
        </TouchableOpacity>
        <TextInput
          value={draft ?? (value !== undefined ? String(value) : "")}
          onChangeText={setDraft}
          onBlur={() => commit(draft ?? "")}
          onSubmitEditing={() => commit(draft ?? "")}
          placeholder={spec.default !== undefined ? String(spec.default) : "auto"}
          placeholderTextColor={T.textDim}
          keyboardType="numeric"
          editable={!disabled}
          style={[
            styles.numberInput,
            { color: T.textBright, backgroundColor: T.bg, borderColor: T.border },
          ]}
        />
        <TouchableOpacity
          style={[styles.stepper, { backgroundColor: T.bg, borderColor: T.border }]}
          onPress={() => nudge(1)}
          disabled={disabled}
          activeOpacity={0.7}
        >
          <Plus size={14} color={T.text} weight="bold" />
        </TouchableOpacity>
      </View>
    </ParamRow>
  );
}

function EnumParamControl({
  T,
  paramKey,
  spec,
  value,
  disabled,
  onCommit,
  onReset,
}: {
  T: ThemeColors;
  paramKey: string;
  spec: EnumParamSpec;
  value: string | undefined;
  disabled: boolean;
  onCommit: (value: string) => void;
  onReset: () => void;
}) {
  return (
    <ParamRow
      T={T}
      label={paramLabel(paramKey)}
      help={PARAM_HELP[paramKey]}
      isSet={value !== undefined}
      disabled={disabled}
      onReset={onReset}
    >
      <View style={styles.chipRow}>
        {spec.enum.map((member) => {
          const active = value === member;
          const inherited = value === undefined && spec.default === member;
          return (
            <TouchableOpacity
              key={member}
              style={[
                styles.chip,
                {
                  backgroundColor: active ? T.accentSoft : T.bg,
                  borderColor: active ? T.accent : T.border,
                },
                inherited ? styles.chipInherited : null,
              ]}
              onPress={() => onCommit(member)}
              disabled={disabled}
              activeOpacity={0.7}
            >
              <Text
                style={[styles.chipText, { color: active ? T.accent : T.text }]}
                numberOfLines={1}
              >
                {enumOptionLabel(paramKey, member, spec.enum)}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </ParamRow>
  );
}

function BooleanParamControl({
  T,
  paramKey,
  spec,
  value,
  disabled,
  onCommit,
  onReset,
}: {
  T: ThemeColors;
  paramKey: string;
  spec: BooleanParamSpec;
  value: boolean | undefined;
  disabled: boolean;
  onCommit: (value: boolean) => void;
  onReset: () => void;
}) {
  return (
    <ParamRow
      T={T}
      label={paramLabel(paramKey)}
      help={PARAM_HELP[paramKey]}
      isSet={value !== undefined}
      disabled={disabled}
      onReset={onReset}
    >
      <Switch
        value={value ?? spec.default ?? false}
        onValueChange={onCommit}
        disabled={disabled}
        trackColor={{ false: T.border, true: T.accent }}
      />
    </ParamRow>
  );
}

function ParamControl({
  T,
  paramKey,
  spec,
  value,
  disabled,
  onCommit,
  onReset,
}: {
  T: ThemeColors;
  paramKey: string;
  spec: ParamSpec;
  value: ParamValue | undefined;
  disabled: boolean;
  onCommit: (value: ParamValue) => void;
  onReset: () => void;
}) {
  switch (spec.type) {
    case "number":
    case "integer":
      return (
        <NumberParamControl
          T={T}
          paramKey={paramKey}
          spec={spec}
          value={typeof value === "number" ? value : undefined}
          disabled={disabled}
          onCommit={onCommit}
          onReset={onReset}
        />
      );
    case "enum":
      return (
        <EnumParamControl
          T={T}
          paramKey={paramKey}
          spec={spec}
          value={typeof value === "string" ? value : undefined}
          disabled={disabled}
          onCommit={onCommit}
          onReset={onReset}
        />
      );
    case "boolean":
      return (
        <BooleanParamControl
          T={T}
          paramKey={paramKey}
          spec={spec}
          value={typeof value === "boolean" ? value : undefined}
          disabled={disabled}
          onCommit={onCommit}
          onReset={onReset}
        />
      );
  }
}

/**
 * Catalog-driven knob form. Every control is rendered from the model's
 * parameter schema, so a new knob needs no change here.
 */
export function ModelParamsSection({
  T,
  schemaJson,
  values,
  onChange,
  disabled = false,
  title = "PARAMETERS",
  audience = "user",
  inheritedValues,
  renderRowSuffix,
}: {
  T: ThemeColors;
  schemaJson: string;
  values: ModelParamValues;
  onChange: (values: ModelParamValues) => void;
  disabled?: boolean;
  title?: string;
  /** "user" hides knobs the catalog reserves for the agent builder. */
  audience?: "user" | "builder";
  /** What an unset knob falls back to, when that is not the provider default. */
  inheritedValues?: ModelParamValues;
  renderRowSuffix?: (key: string) => React.ReactNode;
}) {
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const schema = useMemo(() => parseModelParamsSchema(schemaJson), [schemaJson]);

  if (!schema) return null;

  const paramKeys = Object.keys(schema.params).filter(
    (key) => audience === "builder" || schema.params[key].audience !== "builder",
  );
  const orderedKeys = paramKeys.includes("reasoning_effort")
    ? ["reasoning_effort", ...paramKeys.filter((k) => k !== "reasoning_effort")]
    : paramKeys;
  const providerOptionKeys = Object.keys(schema.providerOptions);
  const providerOptionValues = values.provider_options ?? {};
  const hasAnyValue = Object.keys(values).length > 0;

  if (orderedKeys.length === 0 && providerOptionKeys.length === 0) return null;

  const setParam = (key: string, value: ParamValue) => onChange({ ...values, [key]: value });
  const resetParam = (key: string) => {
    const next = { ...values };
    delete next[key];
    onChange(next);
  };
  const setProviderOption = (key: string, value: ParamValue) =>
    onChange({ ...values, provider_options: { ...providerOptionValues, [key]: value } });
  const resetProviderOption = (key: string) => {
    const nested = { ...providerOptionValues };
    delete nested[key];
    const next = { ...values };
    if (Object.keys(nested).length > 0) next.provider_options = nested;
    else delete next.provider_options;
    onChange(next);
  };

  return (
    <View>
      <View style={styles.sectionHead}>
        <Text style={[styles.sectionLabel, { color: T.textDim }]}>{title}</Text>
        {hasAnyValue ? (
          <TouchableOpacity
            onPress={() => onChange({})}
            disabled={disabled}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            style={styles.resetChip}
          >
            <ArrowCounterClockwise size={11} color={T.accent} weight="bold" />
            <Text style={[styles.resetText, { color: T.accent }]}>Reset all</Text>
          </TouchableOpacity>
        ) : null}
      </View>

      {orderedKeys.map((key) => (
        <View key={key}>
          <ParamControl
            T={T}
            paramKey={key}
            spec={withInherited(schema.params[key], scalarValue(inheritedValues?.[key]))}
            value={scalarValue(values[key])}
            disabled={disabled}
            onCommit={(value) => setParam(key, value)}
            onReset={() => resetParam(key)}
          />
          {renderRowSuffix?.(key)}
        </View>
      ))}

      {providerOptionKeys.length > 0 ? (
        <View>
          <TouchableOpacity
            style={styles.advancedToggle}
            onPress={() => setAdvancedOpen((open) => !open)}
            activeOpacity={0.7}
          >
            <CaretRight
              size={12}
              color={T.textDim}
              weight="bold"
              style={advancedOpen ? styles.caretOpen : undefined}
            />
            <Text style={[styles.advancedLabel, { color: T.textDim }]}>
              Advanced (provider-specific)
            </Text>
          </TouchableOpacity>
          {advancedOpen
            ? providerOptionKeys.map((key) => (
                <ParamControl
                  key={key}
                  T={T}
                  paramKey={key}
                  spec={withInherited(
                    schema.providerOptions[key],
                    inheritedValues?.provider_options?.[key],
                  )}
                  value={providerOptionValues[key]}
                  disabled={disabled}
                  onCommit={(value) => setProviderOption(key, value)}
                  onReset={() => resetProviderOption(key)}
                />
              ))
            : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  sectionHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 20,
    marginBottom: 4,
  },
  sectionLabel: { fontSize: 11, fontFamily: FONT.semibold, letterSpacing: 0.8 },
  resetChip: { flexDirection: "row", alignItems: "center", gap: 4 },
  resetText: { fontSize: 11, fontFamily: FONT.medium },
  inheritTag: { fontSize: 11, fontFamily: FONT.regular },
  paramRow: { paddingTop: 12 },
  paramHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 6,
  },
  paramLabel: { fontSize: 12, fontFamily: FONT.semibold, letterSpacing: 0.4 },
  paramHelp: { fontSize: 11, fontFamily: FONT.regular, marginTop: 5, lineHeight: 15 },
  numberRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  stepper: {
    width: 40,
    height: 40,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: "center",
    justifyContent: "center",
  },
  numberInput: {
    flex: 1,
    height: 40,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12,
    // Android gives a TextInput its own vertical padding and font padding on
    // top of the fixed height, which clips the glyphs; zero both and let the
    // height centre the line.
    paddingVertical: 0,
    includeFontPadding: false,
    textAlignVertical: "center",
    fontSize: 15,
    fontFamily: FONT.medium,
    textAlign: "center",
  },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 9,
    borderWidth: StyleSheet.hairlineWidth,
  },
  chipInherited: { borderStyle: "dashed" },
  chipText: { fontSize: 12, fontFamily: FONT.medium },
  advancedToggle: { flexDirection: "row", alignItems: "center", gap: 6, paddingTop: 16 },
  advancedLabel: { fontSize: 12, fontFamily: FONT.medium },
  caretOpen: { transform: [{ rotate: "90deg" }] },
});
