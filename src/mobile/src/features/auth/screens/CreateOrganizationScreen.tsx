import React, { useRef, useState } from "react";
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  TextInput,
  StyleSheet,
  Platform,
  ActivityIndicator,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuth } from "@core/providers/AuthContext";
import {
  slugFromInput,
  slugFromName,
  type CreateOrganizationField,
} from "@features/auth/createOrganizationForm";
import { useCreateOrganization } from "@features/auth/useMyOrganizations";
import { DomainHeader } from "@shared/components/DomainHeader";
import { useTheme } from "@shared/hooks/useTheme";
import { BOTTOM_NAV_HEIGHT } from "@theme/theme";
import { FONT } from "@theme/typography";

const MAX_LENGTH = 255;

export function CreateOrganizationScreen() {
  const T = useTheme();
  const insets = useSafeAreaInsets();
  const { organizationId } = useAuth();
  const navPad = Platform.OS === "web" ? BOTTOM_NAV_HEIGHT + 34 : BOTTOM_NAV_HEIGHT + insets.bottom;
  // The bottom bar shows only once the session is in an organization.
  const bottomPad = organizationId ? navPad : insets.bottom + 24;
  const { submit, submitting, failure, created } = useCreateOrganization();
  const slugInput = useRef<TextInput>(null);

  const [name, setName] = useState("");
  // Null while untouched, so the slug keeps following the name.
  const [customSlug, setCustomSlug] = useState<string | null>(null);
  const slug = customSlug ?? slugFromName(name);
  const trimmedName = name.trim();
  const canSubmit = (created || trimmedName.length > 0) && !submitting;

  const fieldError = (field: CreateOrganizationField) =>
    failure?.field === field ? failure.message : null;
  const nameError = fieldError("name");
  const slugError = fieldError("slug");
  const formError = failure && failure.field === null ? failure.message : null;

  const handleSubmit = () => {
    if (!canSubmit) return;
    void submit({ name: trimmedName, slug: slugFromName(slug) || undefined });
  };

  return (
    <View style={[styles.container, { backgroundColor: T.pageBg }]}>
      <DomainHeader title="New organization" color={T.accent} icon="organization" />

      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: bottomPad }]}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={[styles.label, { color: T.textDim }]}>NAME</Text>
        <TextInput
          value={name}
          onChangeText={setName}
          placeholder="Acme Inc."
          placeholderTextColor={T.textDim}
          style={[
            styles.input,
            {
              color: T.textBright,
              backgroundColor: T.surface,
              borderColor: nameError ? T.red : T.border,
            },
          ]}
          maxLength={MAX_LENGTH}
          editable={!created && !submitting}
          autoFocus
          autoCapitalize="words"
          autoCorrect={false}
          returnKeyType="next"
          onSubmitEditing={() => slugInput.current?.focus()}
          accessibilityLabel="Organization name"
        />
        {nameError ? <Text style={[styles.fieldError, { color: T.red }]}>{nameError}</Text> : null}

        <Text style={[styles.label, { color: T.textDim, marginTop: 22 }]}>SLUG</Text>
        <TextInput
          ref={slugInput}
          value={slug}
          onChangeText={(value) => setCustomSlug(slugFromInput(value))}
          placeholder="acme"
          placeholderTextColor={T.textDim}
          style={[
            styles.input,
            {
              color: T.textBright,
              backgroundColor: T.surface,
              borderColor: slugError ? T.red : T.border,
            },
          ]}
          maxLength={MAX_LENGTH}
          editable={!created && !submitting}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="done"
          onSubmitEditing={handleSubmit}
          accessibilityLabel="Organization slug"
        />
        {slugError ? (
          <Text style={[styles.fieldError, { color: T.red }]}>{slugError}</Text>
        ) : (
          <Text style={[styles.hint, { color: T.textDim }]}>
            Used in links. Lowercase letters, digits and hyphens.
          </Text>
        )}

        {formError ? (
          <View
            style={[styles.errorBox, { backgroundColor: T.red + "1F", borderColor: T.red + "33" }]}
          >
            <Text style={[styles.errorText, { color: T.red }]}>{formError}</Text>
          </View>
        ) : null}

        <TouchableOpacity
          style={[
            styles.submit,
            { backgroundColor: canSubmit || submitting ? T.accent : T.surfaceHover },
          ]}
          onPress={handleSubmit}
          disabled={!canSubmit}
          activeOpacity={0.8}
          accessibilityRole="button"
          accessibilityState={{ disabled: !canSubmit, busy: submitting }}
        >
          {submitting ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <Text style={[styles.submitText, { color: canSubmit ? "#fff" : T.textDim }]}>
              {created ? "Open organization" : "Create organization"}
            </Text>
          )}
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: 20 },
  label: { fontSize: 11, fontFamily: FONT.semibold, letterSpacing: 0.8, marginBottom: 8 },
  input: {
    height: 48,
    paddingHorizontal: 14,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    fontSize: 15,
    fontFamily: FONT.medium,
  },
  hint: { fontSize: 12, fontFamily: FONT.regular, marginTop: 6 },
  fieldError: { fontSize: 12, fontFamily: FONT.medium, marginTop: 6 },
  errorBox: {
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginTop: 22,
  },
  errorText: { fontSize: 13, fontFamily: FONT.medium },
  submit: {
    marginTop: 28,
    height: 48,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  submitText: { fontSize: 15, fontFamily: FONT.semibold },
});
