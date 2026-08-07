import React from "react";
import { View, TextInput, TouchableOpacity, StyleSheet } from "react-native";
import { X } from "phosphor-react-native";
import { useTheme } from "@shared/hooks/useTheme";
import { FONT } from "@theme/typography";

/** Filter field for a `BottomSheet`, with the clear affordance every list needs. */
export function SheetSearchBar({
  value,
  onChangeText,
  placeholder,
  autoCapitalize = "sentences",
}: {
  value: string;
  onChangeText: (next: string) => void;
  placeholder: string;
  autoCapitalize?: "none" | "sentences";
}) {
  const T = useTheme();

  return (
    <View style={[styles.bar, { backgroundColor: T.pageBg, borderColor: T.border }]}>
      <TextInput
        style={[styles.input, { color: T.textBright }]}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={T.textDim}
        autoCapitalize={autoCapitalize}
        autoCorrect={false}
        returnKeyType="done"
      />
      {value.length > 0 && (
        <TouchableOpacity
          onPress={() => onChangeText("")}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <X size={15} color={T.textDim} weight="bold" />
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginHorizontal: 16,
    marginBottom: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
  },
  input: { flex: 1, fontSize: 15, fontFamily: FONT.regular, padding: 0 },
});
