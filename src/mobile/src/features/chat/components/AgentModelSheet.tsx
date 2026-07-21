import React, { useMemo, useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Modal,
  ScrollView,
  Switch,
  ActivityIndicator,
} from "react-native";
import { ArrowCounterClockwise, Check, Faders } from "phosphor-react-native";
import type { ThemeColors } from "@theme/theme";
import { FONT } from "@theme/typography";
import { useAgentModels, type AgentModelOption } from "@features/agents/useAgents";
import {
  useChannelAgentConfig,
  useUpdateChannelAgentConfig,
} from "@features/chat/useChannelAgentConfig";
import {
  parseModelParamsSchema,
  parseModelParamValues,
  stripInvalidParams,
  encodeModelParamValues,
  clampNumberParam,
  type BooleanParamSpec,
  type EnumParamSpec,
  type ModelParamValues,
  type NumberParamSpec,
  type ParamSpec,
  type ParamValue,
} from "@features/chat/utils/modelParams";

const PARAM_LABELS: Record<string, string> = {
  temperature: "Temperature",
  top_p: "Top P",
  top_k: "Top K",
  max_tokens: "Max tokens",
  reasoning_effort: "Reasoning effort",
};

function paramLabel(key: string): string {
  if (PARAM_LABELS[key]) return PARAM_LABELS[key];
  const words = key.replace(/_/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function memberLabel(member: string): string {
  return member.charAt(0).toUpperCase() + member.slice(1);
}

const scalarValue = (
  value: ParamValue | Record<string, ParamValue> | undefined,
): ParamValue | undefined => (typeof value === "object" ? undefined : value);

export function AgentModelSheet({
  visible,
  T,
  channelId,
  agentId,
  agentPrimaryModel,
  agentProviderKeyId,
  onClose,
}: {
  visible: boolean;
  T: ThemeColors;
  channelId: string;
  agentId: string;
  agentPrimaryModel: string;
  agentProviderKeyId: string;
  onClose: () => void;
}) {
  const configQuery = useChannelAgentConfig(channelId, agentId, visible);
  const update = useUpdateChannelAgentConfig(channelId, agentId);
  const modelsQuery = useAgentModels(agentProviderKeyId, visible);

  const models = useMemo(() => modelsQuery.data ?? [], [modelsQuery.data]);
  const modelOverride = configQuery.data?.modelOverride ?? "";
  const effectiveModelId = modelOverride || agentPrimaryModel;

  const schema = useMemo(() => {
    const json = models.find((m) => m.id === effectiveModelId)?.parameterSchemaJson ?? "";
    return parseModelParamsSchema(json);
  }, [models, effectiveModelId]);

  const values = useMemo(
    () => parseModelParamValues(configQuery.data?.modelParamsOverrideJson ?? ""),
    [configQuery.data?.modelParamsOverrideJson],
  );

  const commitValues = (next: ModelParamValues) => {
    update.mutate({ modelParamsOverrideJson: encodeModelParamValues(next) });
  };

  const pickModel = (modelId: string) => {
    if (modelId === modelOverride) return;
    const nextEffective = modelId || agentPrimaryModel;
    const nextSchema = parseModelParamsSchema(
      models.find((m) => m.id === nextEffective)?.parameterSchemaJson ?? "",
    );
    update.mutate({
      modelOverride: modelId,
      modelParamsOverrideJson: encodeModelParamValues(stripInvalidParams(nextSchema, values)),
    });
  };

  const setParam = (key: string, value: ParamValue) => commitValues({ ...values, [key]: value });
  const resetParam = (key: string) => {
    const next = { ...values };
    delete next[key];
    commitValues(next);
  };
  const providerOptionValues = values.provider_options ?? {};
  const setProviderOption = (key: string, value: ParamValue) =>
    commitValues({ ...values, provider_options: { ...providerOptionValues, [key]: value } });
  const resetProviderOption = (key: string) => {
    const nested = { ...providerOptionValues };
    delete nested[key];
    const next = { ...values };
    if (Object.keys(nested).length > 0) next.provider_options = nested;
    else delete next.provider_options;
    commitValues(next);
  };

  const paramKeys = schema ? Object.keys(schema.params) : [];
  const orderedKeys = paramKeys.includes("reasoning_effort")
    ? ["reasoning_effort", ...paramKeys.filter((k) => k !== "reasoning_effort")]
    : paramKeys;
  const providerOptionKeys = schema ? Object.keys(schema.providerOptions) : [];
  const hasAnyValue = Object.keys(values).length > 0;
  const overrideInList = !modelOverride || models.some((m) => m.id === modelOverride);
  const loading = configQuery.isLoading || modelsQuery.isLoading;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={onClose} />
      <View style={[styles.sheet, { backgroundColor: T.surface }]}>
        <View style={[styles.handle, { backgroundColor: T.border }]} />
        <View style={styles.header}>
          <Faders size={18} color={T.accent} weight="duotone" />
          <Text style={[styles.title, { color: T.textBright }]}>Model for this chat</Text>
        </View>

        {loading ? (
          <View style={styles.loading}>
            <ActivityIndicator size="small" color={T.accent} />
          </View>
        ) : (
          <ScrollView style={styles.scroll} keyboardShouldPersistTaps="handled">
            <Text style={[styles.sectionLabel, { color: T.textDim }]}>MODEL</Text>
            <ModelRow
              T={T}
              title="Agent default"
              subtitle={agentPrimaryModel || undefined}
              selected={!modelOverride}
              onPress={() => pickModel("")}
            />
            {overrideInList ? null : (
              <ModelRow
                T={T}
                title={modelOverride}
                subtitle="Unavailable"
                selected
                onPress={() => {}}
              />
            )}
            {models.map((m: AgentModelOption) => (
              <ModelRow
                key={m.id}
                T={T}
                title={m.displayName || m.id}
                subtitle={m.provider}
                selected={modelOverride === m.id}
                onPress={() => pickModel(m.id)}
              />
            ))}
            {models.length === 0 ? (
              <Text style={[styles.empty, { color: T.textDim }]}>No models available</Text>
            ) : null}

            {schema ? (
              <>
                <View style={styles.paramsHeader}>
                  <Text style={[styles.sectionLabel, { color: T.textDim }]}>PARAMETERS</Text>
                  {hasAnyValue ? (
                    <TouchableOpacity
                      onPress={() => commitValues({})}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                      style={styles.resetAllBtn}
                    >
                      <ArrowCounterClockwise size={12} color={T.textDim} weight="bold" />
                      <Text style={[styles.resetAllText, { color: T.textDim }]}>Reset all</Text>
                    </TouchableOpacity>
                  ) : null}
                </View>
                {orderedKeys.map((key) => (
                  <ParamField
                    key={key}
                    T={T}
                    paramKey={key}
                    spec={schema.params[key]}
                    value={scalarValue(values[key])}
                    onCommit={(value) => setParam(key, value)}
                    onReset={() => resetParam(key)}
                  />
                ))}
                {providerOptionKeys.length > 0 ? (
                  <Text style={[styles.sectionLabel, { color: T.textDim }]}>ADVANCED</Text>
                ) : null}
                {providerOptionKeys.map((key) => (
                  <ParamField
                    key={key}
                    T={T}
                    paramKey={key}
                    spec={schema.providerOptions[key]}
                    value={providerOptionValues[key]}
                    onCommit={(value) => setProviderOption(key, value)}
                    onReset={() => resetProviderOption(key)}
                  />
                ))}
              </>
            ) : null}
            <View style={styles.bottomPad} />
          </ScrollView>
        )}
      </View>
    </Modal>
  );
}

function ModelRow({
  T,
  title,
  subtitle,
  selected,
  onPress,
}: {
  T: ThemeColors;
  title: string;
  subtitle?: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity
      style={[styles.modelRow, { borderTopColor: T.border }]}
      onPress={onPress}
      activeOpacity={0.7}
    >
      <View style={{ flex: 1 }}>
        <Text style={[styles.modelName, { color: T.textBright }]} numberOfLines={1}>
          {title}
        </Text>
        {subtitle ? (
          <Text style={[styles.modelMeta, { color: T.textDim }]} numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {selected ? <Check size={16} color={T.accent} weight="bold" /> : null}
    </TouchableOpacity>
  );
}

function ParamRow({
  T,
  label,
  isSet,
  hint,
  onReset,
  children,
}: {
  T: ThemeColors;
  label: string;
  isSet: boolean;
  hint?: string;
  onReset: () => void;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.paramRow}>
      <View style={styles.paramHeader}>
        <Text style={[styles.paramLabel, { color: T.textDim }]}>{label}</Text>
        {isSet ? (
          <TouchableOpacity
            onPress={onReset}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            accessibilityRole="button"
            accessibilityLabel={`Reset ${label} to provider default`}
          >
            <ArrowCounterClockwise size={12} color={T.textDim} weight="bold" />
          </TouchableOpacity>
        ) : (
          <Text style={[styles.paramDefault, { color: T.textDim }]}>Default</Text>
        )}
      </View>
      {children}
      {hint ? <Text style={[styles.paramHint, { color: T.textDim }]}>{hint}</Text> : null}
    </View>
  );
}

function NumberField({
  T,
  paramKey,
  spec,
  value,
  onCommit,
  onReset,
}: {
  T: ThemeColors;
  paramKey: string;
  spec: NumberParamSpec;
  value: number | undefined;
  onCommit: (value: number) => void;
  onReset: () => void;
}) {
  const [text, setText] = useState<string | null>(null);

  const commit = () => {
    if (text === null) return;
    const trimmed = text.trim();
    setText(null);
    if (trimmed === "") {
      if (value !== undefined) onReset();
      return;
    }
    const next = clampNumberParam(spec, trimmed);
    if (next !== null && next !== value) onCommit(next);
  };

  const hint = [
    spec.minimum !== undefined ? `min ${spec.minimum}` : null,
    spec.maximum !== undefined ? `max ${spec.maximum}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <ParamRow
      T={T}
      label={paramLabel(paramKey)}
      isSet={value !== undefined}
      hint={hint || undefined}
      onReset={onReset}
    >
      <TextInput
        value={text ?? (value !== undefined ? String(value) : "")}
        onChangeText={setText}
        onBlur={commit}
        onSubmitEditing={commit}
        keyboardType={spec.type === "integer" ? "number-pad" : "decimal-pad"}
        placeholder={spec.default !== undefined ? String(spec.default) : "auto"}
        placeholderTextColor={T.textDim}
        style={[
          styles.numberInput,
          { color: T.textBright, backgroundColor: T.bg, borderColor: T.border },
        ]}
      />
    </ParamRow>
  );
}

function EnumField({
  T,
  paramKey,
  spec,
  value,
  onCommit,
  onReset,
}: {
  T: ThemeColors;
  paramKey: string;
  spec: EnumParamSpec;
  value: string | undefined;
  onCommit: (value: string) => void;
  onReset: () => void;
}) {
  return (
    <ParamRow T={T} label={paramLabel(paramKey)} isSet={value !== undefined} onReset={onReset}>
      <View style={styles.pillRow}>
        {spec.enum.map((member) => {
          const active = value === member;
          return (
            <TouchableOpacity
              key={member}
              style={[
                styles.pill,
                active
                  ? { backgroundColor: T.accent }
                  : {
                      backgroundColor: T.bg,
                      borderColor: T.border,
                      borderWidth: StyleSheet.hairlineWidth,
                    },
              ]}
              // Tapping the active pill clears the override back to provider default.
              onPress={() => (active ? onReset() : onCommit(member))}
              activeOpacity={0.7}
            >
              <Text style={[styles.pillText, { color: active ? "#fff" : T.textDim }]}>
                {memberLabel(member)}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </ParamRow>
  );
}

function BooleanField({
  T,
  paramKey,
  spec,
  value,
  onCommit,
  onReset,
}: {
  T: ThemeColors;
  paramKey: string;
  spec: BooleanParamSpec;
  value: boolean | undefined;
  onCommit: (value: boolean) => void;
  onReset: () => void;
}) {
  return (
    <ParamRow T={T} label={paramLabel(paramKey)} isSet={value !== undefined} onReset={onReset}>
      <View style={styles.switchWrap}>
        <Switch
          value={value ?? spec.default ?? false}
          onValueChange={onCommit}
          trackColor={{ true: T.accent, false: T.border }}
          thumbColor="#fff"
        />
      </View>
    </ParamRow>
  );
}

function ParamField({
  T,
  paramKey,
  spec,
  value,
  onCommit,
  onReset,
}: {
  T: ThemeColors;
  paramKey: string;
  spec: ParamSpec;
  value: ParamValue | undefined;
  onCommit: (value: ParamValue) => void;
  onReset: () => void;
}) {
  switch (spec.type) {
    case "number":
    case "integer":
      return (
        <NumberField
          T={T}
          paramKey={paramKey}
          spec={spec}
          value={typeof value === "number" ? value : undefined}
          onCommit={onCommit}
          onReset={onReset}
        />
      );
    case "enum":
      return (
        <EnumField
          T={T}
          paramKey={paramKey}
          spec={spec}
          value={typeof value === "string" ? value : undefined}
          onCommit={onCommit}
          onReset={onReset}
        />
      );
    case "boolean":
      return (
        <BooleanField
          T={T}
          paramKey={paramKey}
          spec={spec}
          value={typeof value === "boolean" ? value : undefined}
          onCommit={onCommit}
          onReset={onReset}
        />
      );
  }
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)" },
  sheet: { borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingBottom: 24, maxHeight: "85%" },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    alignSelf: "center",
    marginTop: 8,
    marginBottom: 8,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 20,
    paddingBottom: 4,
  },
  title: { fontSize: 16, fontFamily: FONT.semibold, flexShrink: 1 },
  loading: { paddingVertical: 32, alignItems: "center" },
  scroll: { paddingHorizontal: 20 },
  sectionLabel: {
    fontSize: 11,
    fontFamily: FONT.semibold,
    letterSpacing: 0.8,
    marginTop: 16,
    marginBottom: 8,
  },
  empty: { fontSize: 13, fontFamily: FONT.regular, textAlign: "center", paddingVertical: 16 },
  modelRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  modelName: { fontSize: 14, fontFamily: FONT.medium },
  modelMeta: { fontSize: 11, fontFamily: FONT.regular, marginTop: 1 },
  paramsHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  resetAllBtn: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 16 },
  resetAllText: { fontSize: 11, fontFamily: FONT.semibold },
  paramRow: { paddingVertical: 8 },
  paramHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 6,
  },
  paramLabel: {
    fontSize: 12,
    fontFamily: FONT.semibold,
    letterSpacing: 0.3,
  },
  paramDefault: { fontSize: 10, fontFamily: FONT.regular },
  paramHint: { fontSize: 10, fontFamily: FONT.regular, marginTop: 4 },
  pillRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  pill: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 16 },
  pillText: { fontSize: 12, fontFamily: FONT.semibold },
  numberInput: {
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 10,
    paddingVertical: 7,
    fontSize: 14,
    fontFamily: FONT.medium,
  },
  switchWrap: { alignItems: "flex-start" },
  bottomPad: { height: 12 },
});
