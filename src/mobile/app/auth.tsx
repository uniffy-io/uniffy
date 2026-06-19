import React, { useState, useRef } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Animated,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Keyboard,
  useWindowDimensions,
} from "react-native";

import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router } from "expo-router";
import { LinearGradient } from "expo-linear-gradient";
import { Envelope, Lock, User, IdentificationCard, ShieldCheck } from "phosphor-react-native";
import { NetworkCanvas } from "@/components/NetworkCanvas";
import { OneRingAnimation } from "@/components/OneRingAnimation";
import { useAuth } from "@/context/auth-context";
import { authApi } from "@/api/authApi";

type Mode = "login" | "register";

type MfaChallengeState = { challengeToken: string; methods: string[] };

export default function AuthScreen() {
  const insets = useSafeAreaInsets();
  const { height: screenHeight } = useWindowDimensions();
  const { login, verifyMfa, register, setHoldNavigation } = useAuth();

  const [mode, setMode] = useState<Mode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [username, setUsername] = useState("");
  const [fullName, setFullName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [showAnimation, setShowAnimation] = useState(false);
  const [mfaChallenge, setMfaChallenge] = useState<MfaChallengeState | null>(null);
  const [mfaCode, setMfaCode] = useState("");
  const [mfaMethod, setMfaMethod] = useState<"totp" | "recovery_code">("totp");
  const [forgotMode, setForgotMode] = useState(false);
  const [resetSent, setResetSent] = useState(false);
  const authErrorRef = useRef<string | null>(null);
  const pendingMfaRef = useRef<MfaChallengeState | null>(null);
  const pendingEnrollRef = useRef<string | null>(null);

  // Animated pill indicator
  const pillAnim = useRef(new Animated.Value(0)).current;

  const switchMode = (newMode: Mode) => {
    setMode(newMode);
    setError(null);
    Animated.spring(pillAnim, {
      toValue: newMode === "login" ? 0 : 1,
      useNativeDriver: false,
      tension: 80,
      friction: 12,
    }).start();
  };

  const handleSubmit = async () => {
    Keyboard.dismiss();
    setError(null);
    setLoading(true);
    setHoldNavigation(true);
    setShowAnimation(true);
    authErrorRef.current = null;

    try {
      if (mode === "login") {
        const result = await login(email.trim(), password);
        if (result.status === "mfa") {
          pendingMfaRef.current = { challengeToken: result.challengeToken, methods: result.methods };
        } else if (result.status === "enroll") {
          pendingEnrollRef.current = result.enrollmentToken;
        }
      } else {
        await register(email.trim(), username.trim(), password, fullName.trim() || undefined);
      }
    } catch (err: any) {
      const msg = err?.message || "Something went wrong";
      if (msg.includes("[")) {
        const match = msg.match(/\] (.+)/);
        authErrorRef.current = match ? match[1] : msg;
      } else {
        authErrorRef.current = msg;
      }
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
    setShowAnimation(true);
    authErrorRef.current = null;

    try {
      await verifyMfa(mfaChallenge.challengeToken, mfaCode.trim(), mfaMethod);
    } catch (err: any) {
      const msg = err?.message || "Something went wrong";
      const match = msg.includes("[") ? msg.match(/\] (.+)/) : null;
      authErrorRef.current = match ? match[1] : msg;
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

  const handleAnimationFinished = () => {
    setShowAnimation(false);
    if (authErrorRef.current) {
      setError(authErrorRef.current);
      setHoldNavigation(false);
    } else if (pendingEnrollRef.current) {
      // Org mandates MFA and the user has not enrolled - drive forced enrollment.
      // Navigation stays held; the enroll screen manages it until real tokens land.
      const token = pendingEnrollRef.current;
      pendingEnrollRef.current = null;
      router.push({ pathname: "/enroll-mfa", params: { token } } as any);
    } else if (pendingMfaRef.current) {
      // Password accepted but a second factor is required - show the code step
      const challenge = pendingMfaRef.current;
      setMfaChallenge(challenge);
      setMfaMethod(challenge.methods.includes("totp") ? "totp" : "recovery_code");
      pendingMfaRef.current = null;
      setHoldNavigation(false);
    } else {
      // Auth succeeded - release navigation so AuthGate redirects to app
      setHoldNavigation(false);
    }
  };

  const isValid =
    mode === "login"
      ? email.length > 0 && password.length > 0
      : email.length > 0 && username.length > 0 && password.length > 0;

  const pillLeft = pillAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ["1%", "50%"],
  });

  return (
    <View style={styles.root}>
      {/* Dark background gradient */}
      <LinearGradient
        colors={["#09090b", "#171723", "#1a1a2e"]}
        style={StyleSheet.absoluteFill}
        start={{ x: 0, y: 0 }}
        end={{ x: 0.5, y: 1 }}
      />

      {/* Simulation canvas background */}
      <NetworkCanvas />

      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={styles.flex}
      >
        <ScrollView
          contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + 24 }]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* Fixed spacer — anchors card top so it only grows downward */}
          <View style={{ height: Math.max(screenHeight * 0.3, insets.top + 80) }} />

          {/* Form card */}
          <View style={styles.card}>
            {mfaChallenge ? (
              <>
                <View style={styles.mfaHeader}>
                  <ShieldCheck size={28} color="#ffffff" weight="duotone" />
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
                  icon={<Lock size={18} color="rgba(255,255,255,0.4)" weight="duotone" />}
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
                  <Lock size={28} color="#ffffff" weight="duotone" />
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
                      icon={<Envelope size={18} color="rgba(255,255,255,0.4)" weight="duotone" />}
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
            <View style={styles.pillContainer}>
              <Animated.View style={[styles.pillIndicator, { left: pillLeft }]} />
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
              icon={<Envelope size={18} color="rgba(255,255,255,0.4)" weight="duotone" />}
              placeholder="Email"
              value={email}
              onChangeText={setEmail}
              keyboardType="email-address"
              autoCapitalize="none"
              autoComplete="email"
            />

            <AuthInput
              icon={<Lock size={18} color="rgba(255,255,255,0.4)" weight="duotone" />}
              placeholder="Password"
              value={password}
              onChangeText={setPassword}
              secureTextEntry
            />

            {mode === "register" && (
              <>
                <AuthInput
                  icon={<User size={18} color="rgba(255,255,255,0.4)" weight="duotone" />}
                  placeholder="Username"
                  value={username}
                  onChangeText={setUsername}
                  autoCapitalize="none"
                />
                <AuthInput
                  icon={
                    <IdentificationCard size={18} color="rgba(255,255,255,0.4)" weight="duotone" />
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
              onPress={() => router.push("/accept-invite" as any)}
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

      {showAnimation && <OneRingAnimation onFinished={handleAnimationFinished} />}
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
        placeholderTextColor="rgba(255,255,255,0.3)"
        value={value}
        onChangeText={onChangeText}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        secureTextEntry={secureTextEntry}
        keyboardType={keyboardType}
        autoCapitalize={autoCapitalize}
        autoComplete={autoComplete}
        selectionColor="rgba(255,255,255,0.5)"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: "#09090b",
  },
  flex: { flex: 1 },
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: 24,
  },
  card: {
    backgroundColor: "rgba(255,255,255,0.06)",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
    padding: 20,
    gap: 14,
  },
  pillContainer: {
    flexDirection: "row",
    backgroundColor: "rgba(255,255,255,0.06)",
    borderRadius: 10,
    padding: 3,
    position: "relative",
    marginBottom: 4,
  },
  pillIndicator: {
    position: "absolute",
    top: 3,
    bottom: 3,
    width: "51%",
    backgroundColor: "rgba(255,255,255,0.1)",
    borderRadius: 8,
  },
  pillButton: {
    flex: 1,
    alignItems: "center",
    paddingVertical: 10,
  },
  pillText: {
    fontSize: 14,
    fontFamily: "Inter_500Medium",
    color: "rgba(255,255,255,0.4)",
  },
  pillTextActive: {
    color: "#ffffff",
    fontFamily: "Inter_600SemiBold",
  },
  errorBox: {
    backgroundColor: "rgba(250,82,82,0.12)",
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "rgba(250,82,82,0.2)",
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  errorText: {
    fontSize: 13,
    fontFamily: "Inter_500Medium",
    color: "#FA5252",
  },
  inputRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.05)",
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
    paddingHorizontal: 12,
    height: 48,
    gap: 10,
  },
  inputRowFocused: {
    borderColor: "rgba(255,255,255,0.2)",
    backgroundColor: "rgba(255,255,255,0.08)",
  },
  inputIcon: {
    width: 20,
    alignItems: "center",
  },
  input: {
    flex: 1,
    fontSize: 15,
    fontFamily: "Inter_400Regular",
    color: "#ffffff",
    height: "100%",
  },
  submitButton: {
    backgroundColor: "#ffffff",
    borderRadius: 10,
    height: 48,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 4,
  },
  submitDisabled: {
    opacity: 0.4,
  },
  submitText: {
    fontSize: 15,
    fontFamily: "Inter_600SemiBold",
    color: "#09090b",
  },
  footerText: {
    fontSize: 11,
    fontFamily: "Inter_400Regular",
    color: "rgba(255,255,255,0.25)",
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
    fontFamily: "Inter_600SemiBold",
    color: "#ffffff",
  },
  mfaSubtitle: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    color: "rgba(255,255,255,0.5)",
    textAlign: "center",
    lineHeight: 18,
  },
  mfaBack: {
    fontSize: 13,
    fontFamily: "Inter_500Medium",
    color: "rgba(255,255,255,0.6)",
    textAlign: "center",
    paddingVertical: 4,
  },
  linkText: {
    fontSize: 13,
    fontFamily: "Inter_500Medium",
    color: "rgba(255,255,255,0.55)",
    textAlign: "center",
    paddingVertical: 2,
  },
});
