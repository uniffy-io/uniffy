import React, { useState } from "react";
import { View, Text, TouchableOpacity, StyleSheet, Alert } from "react-native";
import { ArrowsClockwise, Image as ImageIcon } from "phosphor-react-native";
import { BottomSheet } from "@shared/components/BottomSheet";
import { userFacingError } from "@shared/lib/userFacingError";
import { useAuth } from "@core/providers/AuthContext";
import type { ThemeColors } from "@theme/theme";
import { FONT } from "@theme/typography";
import { runtimeApi } from "@features/agents/agentsApi";
import { formatImageCost, type ImageGenerationMeta } from "@features/agents/imageMeta";

const RATIO_PRESETS: { label: string; patch: Record<string, string> }[] = [
  { label: "Square (1:1)", patch: { aspect_ratio: "1:1" } },
  { label: "Landscape (16:9)", patch: { aspect_ratio: "16:9" } },
  { label: "Portrait (9:16)", patch: { aspect_ratio: "9:16" } },
];

const QUALITY_PRESETS: { label: string; patch: Record<string, string> }[] = [
  { label: "Higher resolution (2K)", patch: { resolution: "2K" } },
  { label: "Highest quality", patch: { quality: "high" } },
];

/** Only offer a change that would actually differ from what produced this image. */
function applicablePresets(
  presets: { label: string; patch: Record<string, string> }[],
  params: Record<string, string>,
) {
  return presets.filter(({ patch }) =>
    Object.entries(patch).some(([key, value]) => params[key] !== value),
  );
}

/**
 * Params, cost and a regenerate menu for a generated image, driven by the
 * `tool_meta` the image tool stamps on its result row. Regenerating is a direct
 * re-run of the tool under the caller's identity, not an LLM turn.
 */
export function GeneratedImageCard({
  T,
  meta,
  channelId,
  messageId,
}: {
  T: ThemeColors;
  meta: ImageGenerationMeta;
  channelId: string;
  messageId: string;
}) {
  const { organizationId } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const [pending, setPending] = useState(false);

  const chips = [
    meta.params.aspect_ratio,
    meta.params.resolution,
    meta.params.quality,
    meta.cost !== null ? formatImageCost(meta.cost) : null,
  ].filter((chip): chip is string => !!chip && chip !== "auto");

  const presets = [
    ...applicablePresets(RATIO_PRESETS, meta.params),
    ...applicablePresets(QUALITY_PRESETS, meta.params),
  ];

  const regenerate = async (patch: Record<string, string>) => {
    setMenuOpen(false);
    setPending(true);
    try {
      await runtimeApi.regenerateImage({
        organizationId: organizationId!,
        channelId,
        messageId,
        paramsPatch: JSON.stringify(patch),
      });
    } catch (error) {
      Alert.alert("Could not regenerate", userFacingError(error, "The image was not regenerated."));
    } finally {
      setPending(false);
    }
  };

  return (
    <View style={styles.row}>
      <ImageIcon size={12} color={T.textDim} weight="duotone" />
      <Text style={[styles.chips, { color: T.textDim }]} numberOfLines={1}>
        {chips.length > 0 ? chips.join(" · ") : meta.model}
      </Text>
      {presets.length > 0 ? (
        <TouchableOpacity
          style={[styles.regenButton, { borderColor: T.border }]}
          onPress={() => setMenuOpen(true)}
          disabled={pending}
          activeOpacity={0.7}
        >
          <ArrowsClockwise size={11} color={T.accent} weight="bold" />
          <Text style={[styles.regenLabel, { color: T.accent }]}>
            {pending ? "Regenerating..." : "Regenerate"}
          </Text>
        </TouchableOpacity>
      ) : null}

      <BottomSheet visible={menuOpen} onClose={() => setMenuOpen(false)} style={styles.sheet}>
        <Text style={[styles.sheetTitle, { color: T.textBright }]}>Regenerate with...</Text>
        {presets.map(({ label, patch }) => (
          <TouchableOpacity
            key={label}
            style={[styles.presetRow, { borderTopColor: T.border }]}
            onPress={() => void regenerate(patch)}
            activeOpacity={0.7}
          >
            <Text style={[styles.presetLabel, { color: T.textBright }]}>{label}</Text>
          </TouchableOpacity>
        ))}
      </BottomSheet>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 6, marginTop: 6 },
  chips: { fontSize: 11, fontFamily: FONT.regular, flexShrink: 1 },
  regenButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  regenLabel: { fontSize: 11, fontFamily: FONT.medium },
  sheet: { paddingHorizontal: 20 },
  sheetTitle: { fontSize: 16, fontFamily: FONT.semibold, paddingBottom: 6 },
  presetRow: { paddingVertical: 13, borderTopWidth: StyleSheet.hairlineWidth },
  presetLabel: { fontSize: 14, fontFamily: FONT.medium },
});
