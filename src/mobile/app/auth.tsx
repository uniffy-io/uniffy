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
import { LinearGradient } from "expo-linear-gradient";
import { Envelope, Lock, User, IdentificationCard } from "phosphor-react-native";
import { NetworkCanvas } from "@/components/NetworkCanvas";
import { OneRingAnimation } from "@/components/OneRingAnimation";
import { useAuth } from "@/context/auth-context";

type Mode = "login" | "register";

export default function AuthScreen() {
  const insets = useSafeAreaInsets();
  const { height: screenHeight } = useWindowDimensions();
  const { login, register, setHoldNavigation } = useAuth();

  const [mode, setMode] = useState<Mode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [username, setUsername] = useState("");
  const [fullName, setFullName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [showAnimation, setShowAnimation] = useState(false);
  const authErrorRef = useRef<string | null>(null);

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
        await login(email.trim(), password);
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

  const handleAnimationFinished = () => {
    setShowAnimation(false);
    if (authErrorRef.current) {
      setError(authErrorRef.current);
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

            <Text style={styles.footerText}>
              By continuing, you agree to the Terms of Service and Privacy Policy.
            </Text>
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
});
