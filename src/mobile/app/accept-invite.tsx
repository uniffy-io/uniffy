import React, { useState, useEffect, useCallback } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Buildings, EnvelopeSimple } from "phosphor-react-native";
import { useTheme } from "@/hooks/useTheme";
import { FONT } from "@/constants/typography";
import { useAuth } from "@/context/auth-context";
import { authApi } from "@/api/authApi";

interface InvitePreview {
  email: string;
  organizationName: string;
  inviterDisplayName?: string;
}

export default function AcceptInviteScreen() {
  const T = useTheme();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ token?: string }>();
  const { acceptInvitation, setHoldNavigation } = useAuth();

  const [token, setToken] = useState(params.token ?? "");
  const [tokenInput, setTokenInput] = useState("");
  const [preview, setPreview] = useState<InvitePreview | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(!!params.token);
  const [error, setError] = useState<string | null>(null);

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    setHoldNavigation(true);
    return () => setHoldNavigation(false);
  }, [setHoldNavigation]);

  const loadPreview = useCallback(async (t: string) => {
    setLoadingPreview(true);
    setError(null);
    try {
      const res = await authApi.getInvitation(t);
      setPreview({
        email: res.email,
        organizationName: res.organizationName,
        inviterDisplayName: res.inviterDisplayName,
      });
      setToken(t);
    } catch (err: any) {
      setError(friendly(err) || "This invitation is invalid or has expired.");
      setPreview(null);
    } finally {
      setLoadingPreview(false);
    }
  }, []);

  useEffect(() => {
    if (params.token) loadPreview(params.token);
  }, [params.token, loadPreview]);

  const accept = async () => {
    if (!username.trim() || password.length < 8) return;
    setSubmitting(true);
    setError(null);
    try {
      const result = await acceptInvitation(
        token,
        username.trim(),
        password,
        fullName.trim() || undefined,
      );
      if (result.status === "enroll") {
        router.replace({
          pathname: "/enroll-mfa",
          params: { token: result.enrollmentToken },
        } as any);
      } else {
        setHoldNavigation(false);
        router.replace("/" as any);
      }
    } catch (err: any) {
      setError(friendly(err));
    } finally {
      setSubmitting(false);
    }
  };

  const back = () => {
    setHoldNavigation(false);
    router.replace("/auth" as any);
  };

  return (
    <View style={[styles.root, { backgroundColor: T.pageBg, paddingTop: insets.top + 8 }]}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={{ flex: 1 }}
      >
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <Text style={[styles.heading, { color: T.textBright }]}>Accept invitation</Text>

          {!preview && !loadingPreview ? (
            <>
              <Text style={[styles.sub, { color: T.textDim }]}>
                Paste the invitation code from your email to continue.
              </Text>
              {error ? <Text style={[styles.err, { color: "#FA5252" }]}>{error}</Text> : null}
              <TextInput
                value={tokenInput}
                onChangeText={setTokenInput}
                placeholder="Invitation code"
                placeholderTextColor={T.textDim}
                autoCapitalize="none"
                style={[
                  styles.input,
                  { color: T.textBright, backgroundColor: T.surface, borderColor: T.border },
                ]}
              />
              <TouchableOpacity
                style={[
                  styles.btn,
                  { backgroundColor: tokenInput.trim() ? T.accent : T.surfaceHover },
                ]}
                onPress={() => loadPreview(tokenInput.trim())}
                disabled={!tokenInput.trim()}
              >
                <Text style={[styles.btnText, { color: tokenInput.trim() ? "#fff" : T.textDim }]}>
                  Continue
                </Text>
              </TouchableOpacity>
            </>
          ) : loadingPreview ? (
            <View style={styles.center}>
              <ActivityIndicator color={T.accent} />
            </View>
          ) : preview ? (
            <>
              <View
                style={[styles.previewCard, { backgroundColor: T.surface, borderColor: T.border }]}
              >
                <View style={[styles.orgIcon, { backgroundColor: T.accentSoft }]}>
                  <Buildings size={22} color={T.accent} weight="duotone" />
                </View>
                <Text style={[styles.orgName, { color: T.textBright }]}>
                  {preview.organizationName}
                </Text>
                {preview.inviterDisplayName ? (
                  <Text style={[styles.inviter, { color: T.textDim }]}>
                    Invited by {preview.inviterDisplayName}
                  </Text>
                ) : null}
                <View style={[styles.emailRow, { borderTopColor: T.border }]}>
                  <EnvelopeSimple size={15} color={T.textDim} weight="duotone" />
                  <Text style={[styles.emailText, { color: T.text }]}>{preview.email}</Text>
                </View>
              </View>

              <Text style={[styles.sub, { color: T.textDim }]}>Set up your account to join.</Text>
              {error ? <Text style={[styles.err, { color: "#FA5252" }]}>{error}</Text> : null}

              <TextInput
                value={username}
                onChangeText={setUsername}
                placeholder="Username"
                placeholderTextColor={T.textDim}
                autoCapitalize="none"
                style={[
                  styles.input,
                  { color: T.textBright, backgroundColor: T.surface, borderColor: T.border },
                ]}
              />
              <TextInput
                value={fullName}
                onChangeText={setFullName}
                placeholder="Full name (optional)"
                placeholderTextColor={T.textDim}
                autoCapitalize="words"
                style={[
                  styles.input,
                  { color: T.textBright, backgroundColor: T.surface, borderColor: T.border },
                ]}
              />
              <TextInput
                value={password}
                onChangeText={setPassword}
                placeholder="Password (min 8 characters)"
                placeholderTextColor={T.textDim}
                secureTextEntry
                style={[
                  styles.input,
                  { color: T.textBright, backgroundColor: T.surface, borderColor: T.border },
                ]}
              />

              <TouchableOpacity
                style={[
                  styles.btn,
                  {
                    backgroundColor:
                      username.trim() && password.length >= 8 ? T.accent : T.surfaceHover,
                  },
                ]}
                onPress={accept}
                disabled={!username.trim() || password.length < 8 || submitting}
              >
                {submitting ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Text
                    style={[
                      styles.btnText,
                      { color: username.trim() && password.length >= 8 ? "#fff" : T.textDim },
                    ]}
                  >
                    Join {preview.organizationName}
                  </Text>
                )}
              </TouchableOpacity>
            </>
          ) : null}

          <TouchableOpacity style={styles.backBtn} onPress={back} activeOpacity={0.7}>
            <Text style={[styles.backText, { color: T.textDim }]}>Back to sign in</Text>
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

function friendly(err: any): string {
  const msg = err?.message || "Something went wrong";
  const match = msg.includes("[") ? msg.match(/\] (.+)/) : null;
  return match ? match[1] : msg;
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { padding: 24, gap: 14 },
  center: { paddingVertical: 40, alignItems: "center" },
  heading: { fontSize: 22, fontFamily: FONT.bold },
  sub: { fontSize: 14, fontFamily: FONT.regular, lineHeight: 20 },
  err: { fontSize: 13, fontFamily: FONT.medium },
  input: {
    height: 48,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 14,
    fontSize: 15,
    fontFamily: FONT.regular,
  },
  btn: {
    height: 48,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 4,
  },
  btnText: { fontSize: 15, fontFamily: FONT.semibold },
  previewCard: {
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 18,
    alignItems: "center",
    gap: 6,
  },
  orgIcon: {
    width: 48,
    height: 48,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  orgName: { fontSize: 17, fontFamily: FONT.bold, marginTop: 4 },
  inviter: { fontSize: 13, fontFamily: FONT.regular },
  emailRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    alignSelf: "stretch",
    justifyContent: "center",
  },
  emailText: { fontSize: 13, fontFamily: FONT.medium },
  backBtn: { alignItems: "center", paddingVertical: 12, marginTop: 4 },
  backText: { fontSize: 14, fontFamily: FONT.medium },
});
