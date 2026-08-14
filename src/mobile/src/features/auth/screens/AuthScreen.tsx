import React, { useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Animated,
  Image,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Keyboard,
  useWindowDimensions,
} from "react-native";

import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router } from "expo-router";
import { LinearGradient } from "expo-linear-gradient";
import {
  Envelope,
  Lock,
  User,
  IdentificationCard,
  ShieldCheck,
  Globe,
} from "phosphor-react-native";
import { BRAND } from "@theme/theme";
import { FONT } from "@theme/typography";
import { useAuth } from "@core/providers/AuthContext";
import { authApi } from "@core/auth/authApi";
import { getServerUrl, setServerUrl } from "@core/config/serverUrl";

type Mode = "login" | "register";

type MfaChallengeState = { challengeToken: string; methods: string[] };

// Lightened violet for small text - pure BRAND.violet is only 3.61:1 on
// Midnight, below the 4.5:1 text threshold.
const LINK_VIOLET = "#9b85ff";

const PILL_GUTTER = 3;

function parseAuthError(err: any): string {
  const msg = err?.message || "Something went wrong";
  const match = msg.includes("[") ? msg.match(/\] (.+)/) : null;
  return match ? match[1] : msg;
}

export function AuthScreen() {
  const insets = useSafeAreaInsets();
  const { height: screenHeight } = useWindowDimensions();
  const { login, verifyMfa, register, setHoldNavigation, setLoginSplashVisible } = useAuth();

  const [mode, setMode] = useState<Mode>("login");
  const [server, setServer] = useState(getServerUrl());
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [username, setUsername] = useState("");
  const [fullName, setFullName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [mfaChallenge, setMfaChallenge] = useState<MfaChallengeState | null>(null);
  const [mfaCode, setMfaCode] = useState("");
  const [mfaMethod, setMfaMethod] = useState<"totp" | "recovery_code">("totp");
  const [forgotMode, setForgotMode] = useState(false);
  const [resetSent, setResetSent] = useState(false);
  // Animated pill indicator slides by measured pixels so it fills its half of
  // the track exactly, gutter included on both sides. The lazy state initializer
  // gives the driver one stable identity for the component's lifetime without
  // parking it in a ref that render then has to read back.
  const [pillAnim] = useState(() => new Animated.Value(0));
  const [pillTrackWidth, setPillTrackWidth] = useState(0);

  const switchMode = (newMode: Mode) => {
    setMode(newMode);
    setError(null);
    Animated.spring(pillAnim, {
      toValue: newMode === "login" ? 0 : 1,
      useNativeDriver: true,
      tension: 80,
      friction: 12,
    }).start();
  };

  const handleSubmit = async () => {
    Keyboard.dismiss();
    setError(null);
    setLoading(true);
    // Hold navigation before the request - tokens may land mid-await and
    // AuthGate must not redirect until the splash has played.
    setHoldNavigation(true);

    try {
      // Point every transport at the chosen server before the auth request.
      await setServerUrl(server);
      if (mode === "login") {
        const result = await login(email.trim(), password);
        if (result.status === "mfa") {
          // Password accepted but a second factor is required - show the code
          // step directly; the splash plays only after full auth success.
          setMfaChallenge({ challengeToken: result.challengeToken, methods: result.methods });
          setMfaMethod(result.methods.includes("totp") ? "totp" : "recovery_code");
          setHoldNavigation(false);
        } else if (result.status === "enroll") {
          // Org mandates MFA and the user has not enrolled - drive forced
          // enrollment. Navigation stays held; the enroll screen manages it
          // until real tokens land.
          router.push({
            pathname: "/enroll-mfa",
            params: { token: result.enrollmentToken },
          } as any);
        } else {
          setLoginSplashVisible(true);
        }
      } else {
        await register(email.trim(), username.trim(), password, fullName.trim() || undefined);
        setLoginSplashVisible(true);
      }
    } catch (err: any) {
      setError(parseAuthError(err));
      setHoldNavigation(false);
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyMfa = async () => {
    if (!mfaChallenge) return;
    Keyboard.dismiss();
    setError(null);
    setLoading(true);
    setHoldNavigation(true);

    try {
      await verifyMfa(mfaChallenge.challengeToken, mfaCode.trim(), mfaMethod);
      setLoginSplashVisible(true);
    } catch (err: any) {
      setError(parseAuthError(err));
      setHoldNavigation(false);
    } finally {
      setLoading(false);
    }
  };

  const cancelMfa = () => {
    setMfaChallenge(null);
    setMfaCode("");
    setMfaMethod("totp");
    setError(null);
  };

  const handleSendReset = async () => {
    if (!email.trim()) return;
    Keyboard.dismiss();
    // The RPC never reveals whether the email exists; always show success.
    try {
      await setServerUrl(server);
      await authApi.sendPasswordReset(email.trim());
    } catch {
      // ignore - intentionally non-revealing
    }
    setResetSent(true);
  };

  const exitForgot = () => {
    setForgotMode(false);
    setResetSent(false);
    setError(null);
  };

  const isValid =
    mode === "login"
      ? email.length > 0 && password.length > 0
      : email.length > 0 && username.length > 0 && password.length > 0;

  const pillSegmentWidth = pillTrackWidth > 0 ? (pillTrackWidth - PILL_GUTTER * 2) / 2 : 0;
  const pillTranslate = pillAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0, pillSegmentWidth],
  });

  return (
    <View style={styles.root}>
      {/* Freeform brand gradient: a violet dome with blue, green, orange, and
          pink blooms that dissolve into Midnight before the form card. */}
      <View style={StyleSheet.absoluteFill} pointerEvents="none">
        <LinearGradient
          colors={["rgba(105,74,255,0.55)", "rgba(105,74,255,0)"]}
          start={{ x: 0.5, y: 0 }}
          end={{ x: 0.5, y: 0.62 }}
          style={StyleSheet.absoluteFill}
        />
        <LinearGradient
          colors={["rgba(74,125,255,0.35)", "rgba(74,125,255,0)"]}
          start={{ x: 0, y: 0 }}
          end={{ x: 0.7, y: 0.42 }}
          style={StyleSheet.absoluteFill}
        />
        <LinearGradient
          colors={["rgba(1,183,127,0.28)", "rgba(1,183,127,0)"]}
          start={{ x: 1, y: 0 }}
          end={{ x: 0.62, y: 0.28 }}
          style={StyleSheet.absoluteFill}
        />
        <LinearGradient
          colors={["rgba(251,97,39,0.18)", "rgba(251,97,39,0)"]}
          start={{ x: 1, y: 0.18 }}
          end={{ x: 0.5, y: 0.5 }}
          style={StyleSheet.absoluteFill}
        />
        <LinearGradient
          colors={["rgba(253,126,234,0.30)", "rgba(253,126,234,0)"]}
          start={{ x: 0.95, y: 0.06 }}
          end={{ x: 0.25, y: 0.45 }}
          style={StyleSheet.absoluteFill}
        />
      </View>

      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={styles.flex}
      >
        <ScrollView
          contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + 24 }]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* Fixed-height header anchors the card top so it only grows downward */}
          <View
            style={[styles.header, { height: Math.max(screenHeight * 0.26, insets.top + 190) }]}
          >
            <Image
              source={require("../../../../assets/images/uniffy-logo.png")}
              style={styles.logo}
              resizeMode="contain"
            />
            <Text style={styles.wordmark}>uniffy</Text>
            <Text style={styles.tagline}>Teamwork - simplified, amplified, unified.</Text>
          </View>

          {/* Form card */}
          <View style={styles.card}>
            {mfaChallenge ? (
              <>
                <View style={styles.mfaHeader}>
                  <ShieldCheck size={28} color={LINK_VIOLET} weight="duotone" />
                  <Text style={styles.mfaTitle}>Two-factor authentication</Text>
                  <Text style={styles.mfaSubtitle}>
                    {mfaMethod === "totp"
                      ? "Enter the 6-digit code from your authenticator app."
                      : "Enter one of your recovery codes (xxxx-xxxx-xxxx)."}
                  </Text>
                </View>

                {error && (
                  <View style={styles.errorBox}>
                    <Text style={styles.errorText}>{error}</Text>
                  </View>
                )}

                <AuthInput
                  icon={<Lock size={18} color="rgba(238,238,238,0.4)" weight="duotone" />}
                  placeholder={mfaMethod === "totp" ? "Authenticator code" : "Recovery code"}
                  value={mfaCode}
                  onChangeText={setMfaCode}
                  keyboardType={mfaMethod === "totp" ? "number-pad" : "default"}
                  autoCapitalize="none"
                />

                <TouchableOpacity
                  style={[
                    styles.submitButton,
                    mfaCode.trim().length < (mfaMethod === "totp" ? 6 : 8) && styles.submitDisabled,
                  ]}
                  onPress={handleVerifyMfa}
                  disabled={mfaCode.trim().length < (mfaMethod === "totp" ? 6 : 8) || loading}
                  activeOpacity={0.8}
                >
                  <Text style={styles.submitText}>Verify</Text>
                </TouchableOpacity>

                {mfaChallenge.methods.includes("recovery_code") && (
                  <TouchableOpacity
                    onPress={() => {
                      setMfaMethod((m) => (m === "totp" ? "recovery_code" : "totp"));
                      setMfaCode("");
                      setError(null);
                    }}
                    activeOpacity={0.7}
                  >
                    <Text style={styles.mfaBack}>
                      {mfaMethod === "totp"
                        ? "Use a recovery code instead"
                        : "Use authenticator code instead"}
                    </Text>
                  </TouchableOpacity>
                )}

                <TouchableOpacity onPress={cancelMfa} activeOpacity={0.7}>
                  <Text style={styles.mfaBack}>Back to sign in</Text>
                </TouchableOpacity>
              </>
            ) : forgotMode ? (
              <>
                <View style={styles.mfaHeader}>
                  <Lock size={28} color={LINK_VIOLET} weight="duotone" />
                  <Text style={styles.mfaTitle}>Reset password</Text>
                  <Text style={styles.mfaSubtitle}>
                    {resetSent
                      ? "If an account exists for that email, a reset link is on its way. Open it on this device or the web to finish."
                      : "Enter your email and we'll send a reset link."}
                  </Text>
                </View>

                {!resetSent && (
                  <>
                    <AuthInput
                      icon={<Globe size={18} color="rgba(238,238,238,0.4)" weight="duotone" />}
                      placeholder="Server"
                      value={server}
                      onChangeText={setServer}
                      keyboardType="url"
                      autoCapitalize="none"
                      autoComplete="off"
                    />
                    <AuthInput
                      icon={<Envelope size={18} color="rgba(238,238,238,0.4)" weight="duotone" />}
                      placeholder="Email"
                      value={email}
                      onChangeText={setEmail}
                      keyboardType="email-address"
                      autoCapitalize="none"
                      autoComplete="email"
                    />
                    <TouchableOpacity
                      style={[styles.submitButton, !email.trim() && styles.submitDisabled]}
                      onPress={handleSendReset}
                      disabled={!email.trim()}
                      activeOpacity={0.8}
                    >
                      <Text style={styles.submitText}>Send reset link</Text>
                    </TouchableOpacity>
                  </>
                )}

                <TouchableOpacity onPress={exitForgot} activeOpacity={0.7}>
                  <Text style={styles.mfaBack}>Back to sign in</Text>
                </TouchableOpacity>
              </>
            ) : (
              <>
                {/* Mode toggle pills */}
                <View
                  style={styles.pillContainer}
                  onLayout={(e) => setPillTrackWidth(e.nativeEvent.layout.width)}
                >
                  {pillSegmentWidth > 0 && (
                    <Animated.View
                      style={[
                        styles.pillIndicator,
                        { width: pillSegmentWidth, transform: [{ translateX: pillTranslate }] },
                      ]}
                    />
                  )}
                  <TouchableOpacity
                    style={styles.pillButton}
                    onPress={() => switchMode("login")}
                    activeOpacity={0.8}
                  >
                    <Text style={[styles.pillText, mode === "login" && styles.pillTextActive]}>
                      Sign in
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.pillButton}
                    onPress={() => switchMode("register")}
                    activeOpacity={0.8}
                  >
                    <Text style={[styles.pillText, mode === "register" && styles.pillTextActive]}>
                      Register
                    </Text>
                  </TouchableOpacity>
                </View>

                {/* Error */}
                {error && (
                  <View style={styles.errorBox}>
                    <Text style={styles.errorText}>{error}</Text>
                  </View>
                )}

                {/* Fields */}
                <AuthInput
                  icon={<Globe size={18} color="rgba(238,238,238,0.4)" weight="duotone" />}
                  placeholder="Server"
                  value={server}
                  onChangeText={setServer}
                  keyboardType="url"
                  autoCapitalize="none"
                  autoComplete="off"
                />

                <AuthInput
                  icon={<Envelope size={18} color="rgba(238,238,238,0.4)" weight="duotone" />}
                  placeholder="Email"
                  value={email}
                  onChangeText={setEmail}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoComplete="email"
                />

                <AuthInput
                  icon={<Lock size={18} color="rgba(238,238,238,0.4)" weight="duotone" />}
                  placeholder="Password"
                  value={password}
                  onChangeText={setPassword}
                  secureTextEntry
                />

                {mode === "register" && (
                  <>
                    <AuthInput
                      icon={<User size={18} color="rgba(238,238,238,0.4)" weight="duotone" />}
                      placeholder="Username"
                      value={username}
                      onChangeText={setUsername}
                      autoCapitalize="none"
                    />
                    <AuthInput
                      icon={
                        <IdentificationCard
                          size={18}
                          color="rgba(238,238,238,0.4)"
                          weight="duotone"
                        />
                      }
                      placeholder="Full name (optional)"
                      value={fullName}
                      onChangeText={setFullName}
                      autoCapitalize="words"
                    />
                  </>
                )}

                {/* Submit */}
                <TouchableOpacity
                  style={[styles.submitButton, !isValid && styles.submitDisabled]}
                  onPress={handleSubmit}
                  disabled={!isValid || loading}
                  activeOpacity={0.8}
                >
                  <Text style={styles.submitText}>
                    {mode === "login" ? "Sign in" : "Create account"}
                  </Text>
                </TouchableOpacity>

                {mode === "login" && (
                  <TouchableOpacity onPress={() => setForgotMode(true)} activeOpacity={0.7}>
                    <Text style={styles.linkText}>Forgot password?</Text>
                  </TouchableOpacity>
                )}

                <TouchableOpacity
                  onPress={() => {
                    // Carry the chosen server into the invite flow.
                    void setServerUrl(server);
                    router.push("/accept-invite" as any);
                  }}
                  activeOpacity={0.7}
                >
                  <Text style={styles.linkText}>Have an invitation? Accept it</Text>
                </TouchableOpacity>

                <Text style={styles.footerText}>
                  By continuing, you agree to the Terms of Service and Privacy Policy.
                </Text>
              </>
            )}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

function AuthInput({
  icon,
  placeholder,
  value,
  onChangeText,
  secureTextEntry,
  keyboardType,
  autoCapitalize,
  autoComplete,
}: {
  icon: React.ReactNode;
  placeholder: string;
  value: string;
  onChangeText: (text: string) => void;
  secureTextEntry?: boolean;
  keyboardType?: TextInput["props"]["keyboardType"];
  autoCapitalize?: TextInput["props"]["autoCapitalize"];
  autoComplete?: TextInput["props"]["autoComplete"];
}) {
  const [focused, setFocused] = useState(false);

  return (
    <View style={[styles.inputRow, focused && styles.inputRowFocused]}>
      <View style={styles.inputIcon}>{icon}</View>
      <TextInput
        style={styles.input}
        placeholder={placeholder}
        placeholderTextColor="rgba(238,238,238,0.35)"
        value={value}
        onChangeText={onChangeText}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        secureTextEntry={secureTextEntry}
        keyboardType={keyboardType}
        autoCapitalize={autoCapitalize}
        autoComplete={autoComplete}
        selectionColor={BRAND.violet}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: BRAND.midnight,
  },
  flex: { flex: 1 },
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: 24,
  },
  header: {
    alignItems: "center",
    justifyContent: "flex-end",
    paddingBottom: 20,
  },
  logo: {
    width: 76,
    height: 76,
    marginBottom: 4,
  },
  wordmark: {
    fontSize: 34,
    fontFamily: FONT.bold,
    color: BRAND.white,
    letterSpacing: -0.5,
  },
  tagline: {
    fontSize: 13,
    fontFamily: FONT.medium,
    color: "rgba(238,238,238,0.55)",
    marginTop: 6,
  },
  card: {
    backgroundColor: "rgba(13,17,30,0.62)",
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "rgba(238,238,238,0.10)",
    padding: 20,
    gap: 14,
  },
  pillContainer: {
    flexDirection: "row",
    backgroundColor: "rgba(238,238,238,0.07)",
    borderRadius: 12,
    position: "relative",
    marginBottom: 4,
  },
  pillIndicator: {
    position: "absolute",
    top: PILL_GUTTER,
    bottom: PILL_GUTTER,
    left: PILL_GUTTER,
    backgroundColor: BRAND.violet,
    borderRadius: 9,
  },
  pillButton: {
    flex: 1,
    alignItems: "center",
    paddingVertical: 13,
  },
  pillText: {
    fontSize: 14,
    fontFamily: FONT.medium,
    color: "rgba(238,238,238,0.5)",
  },
  pillTextActive: {
    color: "#ffffff",
    fontFamily: FONT.semibold,
  },
  errorBox: {
    backgroundColor: "rgba(250,82,82,0.12)",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(250,82,82,0.2)",
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  errorText: {
    fontSize: 13,
    fontFamily: FONT.medium,
    color: "#FA5252",
  },
  inputRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(238,238,238,0.05)",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(238,238,238,0.10)",
    paddingHorizontal: 12,
    height: 48,
    gap: 10,
  },
  inputRowFocused: {
    borderColor: "rgba(105,74,255,0.9)",
    backgroundColor: "rgba(105,74,255,0.08)",
  },
  inputIcon: {
    width: 20,
    alignItems: "center",
  },
  input: {
    flex: 1,
    fontSize: 15,
    fontFamily: FONT.regular,
    color: BRAND.white,
    height: "100%",
  },
  submitButton: {
    backgroundColor: BRAND.violet,
    borderRadius: 12,
    height: 50,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 4,
  },
  submitDisabled: {
    opacity: 0.4,
  },
  submitText: {
    fontSize: 15,
    fontFamily: FONT.semibold,
    color: "#ffffff",
  },
  footerText: {
    fontSize: 11,
    fontFamily: FONT.regular,
    color: "rgba(238,238,238,0.3)",
    textAlign: "center",
    lineHeight: 16,
    marginTop: 2,
  },
  mfaHeader: {
    alignItems: "center",
    gap: 6,
    marginBottom: 4,
  },
  mfaTitle: {
    fontSize: 16,
    fontFamily: FONT.semibold,
    color: BRAND.white,
  },
  mfaSubtitle: {
    fontSize: 13,
    fontFamily: FONT.regular,
    color: "rgba(238,238,238,0.5)",
    textAlign: "center",
    lineHeight: 18,
  },
  mfaBack: {
    fontSize: 13,
    fontFamily: FONT.medium,
    color: "rgba(238,238,238,0.6)",
    textAlign: "center",
    paddingVertical: 4,
  },
  linkText: {
    fontSize: 13,
    fontFamily: FONT.medium,
    color: LINK_VIOLET,
    textAlign: "center",
    paddingVertical: 2,
  },
});
