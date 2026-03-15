import React, { useCallback, useEffect } from "react";
import { TextInput, StyleSheet } from "react-native";
import type { TextInputProps, StyleProp, TextStyle } from "react-native";
import { useMentionInput, toCanonical } from "@/hooks/useMentionInput";

type MentionTextInputProps = {
  initialContent?: string;
  onCanonicalChange?: (canonical: string) => void;
  placeholder?: string;
  style?: StyleProp<TextStyle>;
} & Omit<TextInputProps, "value" | "onChangeText" | "onSelectionChange" | "ref">;

export function MentionTextInput({
  initialContent,
  onCanonicalChange,
  placeholder,
  style,
  ...rest
}: MentionTextInputProps) {
  const {
    displayText,
    setDisplayText,
    onSelectionChange,
    inputRef,
    mentionsRef,
    initFromCanonical,
  } = useMentionInput(initialContent);

  useEffect(() => {
    if (initialContent) {
      initFromCanonical(initialContent);
    }
  }, [initialContent, initFromCanonical]);

  const handleChangeText = useCallback(
    (text: string) => {
      setDisplayText(text);
      if (onCanonicalChange) {
        onCanonicalChange(toCanonical(text, mentionsRef.current));
      }
    },
    [setDisplayText, onCanonicalChange, mentionsRef],
  );

  return (
    <TextInput
      ref={inputRef}
      value={displayText}
      onChangeText={handleChangeText}
      onSelectionChange={onSelectionChange}
      placeholder={placeholder}
      multiline
      textAlignVertical="top"
      style={[styles.input, style]}
      {...rest}
    />
  );
}

const styles = StyleSheet.create({
  input: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    lineHeight: 20,
  },
});
