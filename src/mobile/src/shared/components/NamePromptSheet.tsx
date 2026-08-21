import React, { useState } from "react";
import { View, Text, TextInput, TouchableOpacity, StyleSheet } from "react-native";
import { BottomSheet } from "@shared/components/BottomSheet";
import { useTheme } from "@shared/hooks/useTheme";
import { FONT } from "@theme/typography";

type IconComponent = React.ComponentType<{ size: number; color: string; weight: "duotone" }>;

/**
 * Asks for a single name - a new folder, a category, a rename. A sheet rather
 * than a centred dialog because it is the only shape that stays whole once the
 * keyboard is up: `BottomSheet` lifts and shrinks by the keyboard inset, where
 * a centred card is simply covered from the input down, hiding its own buttons.
 */
export function NamePromptSheet({
  visible,
  title,
  cta,
  onClose,
  onSubmit,
  initialName,
  placeholder = "Name",
  pending = false,
  icon: Icon,
  accentColor,
}: {
  visible: boolean;
  title: string;
  cta: string;
  onClose: () => void;
  onSubmit: (name: string) => void;
  initialName?: string;
  placeholder?: string;
  pending?: boolean;
  icon?: IconComponent;
  accentColor?: string;
}) {
  const T = useTheme();
  const accent = accentColor || T.accent;
  const [name, setName] = useState(initialName ?? "");

  // Render-phase reset, so reopening for a different subject never shows the
  // previous one's name. An effect would paint the stale value for a frame.
  const [wasVisible, setWasVisible] = useState(visible);
  if (visible !== wasVisible) {
    setWasVisible(visible);
    if (visible) setName(initialName ?? "");
  }

  const trimmed = name.trim();
  const submit = () => {
    if (!trimmed || pending) return;
    onSubmit(trimmed);
  };

  return (
    <BottomSheet visible={visible} onClose={onClose} style={styles.sheet}>
      <View style={styles.header}>
        {Icon ? <Icon size={20} color={accent} weight="duotone" /> : null}
        <Text style={[styles.title, { color: T.textBright }]}>{title}</Text>
      </View>

      <TextInput
        value={name}
        onChangeText={setName}
        placeholder={placeholder}
        placeholderTextColor={T.textDim}
        autoFocus
        returnKeyType="done"
        onSubmitEditing={submit}
        style={[
          styles.input,
          { color: T.textBright, backgroundColor: T.bg, borderColor: T.border },
        ]}
      />

      <TouchableOpacity
        style={[styles.cta, { backgroundColor: trimmed ? accent : T.surfaceHover }]}
        disabled={!trimmed || pending}
        onPress={submit}
        activeOpacity={0.8}
      >
        <Text style={[styles.ctaText, { color: trimmed ? "#fff" : T.textDim }]}>
          {pending ? "Saving..." : cta}
        </Text>
      </TouchableOpacity>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  sheet: { paddingHorizontal: 16 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingBottom: 14,
  },
  title: { fontSize: 16, fontFamily: FONT.semibold, flex: 1 },
  input: {
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    fontFamily: FONT.regular,
  },
  cta: {
    marginTop: 14,
    paddingVertical: 13,
    borderRadius: 12,
    alignItems: "center",
  },
  ctaText: { fontSize: 15, fontFamily: FONT.semibold },
});
