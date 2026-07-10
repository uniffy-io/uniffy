import React, { useState, useEffect, useCallback } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  ScrollView,
} from "react-native";
import { SvgXml } from "react-native-svg";
import * as Clipboard from "expo-clipboard";
import { ShieldCheck, Copy, Check, Key } from "phosphor-react-native";
import { useTheme } from "@/hooks/useTheme";
import { FONT } from "@/constants/typography";
import { useAuth } from "@/context/auth-context";
import { mfaApi } from "@/api/mfaApi";

type Phase = "loading" | "scan" | "codes" | "error";

function decodeSvg(b64: string): string | null {
  try {
    // Hermes provides atob; the QR SVG is ASCII so no extra UTF-8 dance needed.
    return atob(b64);
  } catch {
    return null;
  }
}

/**
 * Drives BeginEnrollment -> ConfirmEnrollment -> recovery codes. ConfirmEnrollment
 * returns fresh session tokens (the token_version bump invalidates the old ones),
 * so completeEnrollment adopts them for both settings and forced-login callers.
 */
export function MfaEnrollFlow({ color, onDone }: { color: string; onDone: () => void }) {
  const T = useTheme();
  const { completeEnrollment } = useAuth();

  const [phase, setPhase] = useState<Phase>("loading");
  const [secret, setSecret] = useState("");
  const [qrSvg, setQrSvg] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [copiedSecret, setCopiedSecret] = useState(false);
  const [copiedCodes, setCopiedCodes] = useState(false);

  const begin = useCallback(async () => {
    setPhase("loading");
    setError(null);
    try {
      const res = await mfaApi.beginEnrollment();
      setSecret(res.secretB32);
      setQrSvg(res.qrSvgBase64 ? decodeSvg(res.qrSvgBase64) : null);
      setPhase("scan");
    } catch (err: any) {
      setError(friendly(err));
      setPhase("error");
    }
  }, []);

  useEffect(() => {
    begin();
  }, [begin]);

  const confirm = useCallback(async () => {
    if (code.trim().length < 6) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await mfaApi.confirmEnrollment(code.trim());
      // Adopt the fresh tokens before anything else uses the bearer.
      await completeEnrollment({
        accessToken: res.accessToken,
        refreshToken: res.refreshToken,
        organizationId: res.organizationId,
        organizationRole: res.organizationRole,
      });
      setRecoveryCodes(res.recoveryCodes);
      setPhase("codes");
    } catch (err: any) {
      setError(friendly(err));
    } finally {
      setSubmitting(false);
    }
  }, [code, completeEnrollment]);

  if (phase === "loading") {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={color} />
      </View>
    );
  }

  if (phase === "error") {
    return (
      <View style={styles.center}>
        <Text style={[styles.errText, { color: "#FA5252" }]}>{error}</Text>
        <TouchableOpacity style={[styles.btn, { backgroundColor: color }]} onPress={begin}>
          <Text style={styles.btnText}>Try again</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (phase === "codes") {
    return (
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.headerWrap}>
          <ShieldCheck size={30} color={color} weight="duotone" />
          <Text style={[styles.title, { color: T.textBright }]}>Two-factor is on</Text>
          <Text style={[styles.subtitle, { color: T.textDim }]}>
            Save these recovery codes somewhere safe. Each works once if you lose your
            authenticator.
          </Text>
        </View>
        <View style={[styles.codesBox, { backgroundColor: T.surface, borderColor: T.border }]}>
          {recoveryCodes.map((c) => (
            <Text key={c} style={[styles.codeText, { color: T.textBright }]}>
              {c}
            </Text>
          ))}
        </View>
        <TouchableOpacity
          style={[styles.copyRow, { borderColor: T.border }]}
          onPress={async () => {
            await Clipboard.setStringAsync(recoveryCodes.join("\n"));
            setCopiedCodes(true);
          }}
        >
          {copiedCodes ? (
            <Check size={16} color={color} weight="bold" />
          ) : (
            <Copy size={16} color={T.textDim} weight="duotone" />
          )}
          <Text style={[styles.copyText, { color: copiedCodes ? color : T.text }]}>
            {copiedCodes ? "Copied" : "Copy all codes"}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.btn, { backgroundColor: color }]} onPress={onDone}>
          <Text style={styles.btnText}>Done</Text>
        </TouchableOpacity>
      </ScrollView>
    );
  }

  // scan phase
  return (
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <View style={styles.headerWrap}>
        <ShieldCheck size={30} color={color} weight="duotone" />
        <Text style={[styles.title, { color: T.textBright }]}>Set up authenticator</Text>
        <Text style={[styles.subtitle, { color: T.textDim }]}>
          Scan the QR with your authenticator app, or enter the setup key manually.
        </Text>
      </View>

      {qrSvg ? (
        <View style={[styles.qrWrap, { backgroundColor: "#ffffff" }]}>
          <SvgXml xml={qrSvg} width={180} height={180} />
        </View>
      ) : null}

      <Text style={[styles.label, { color: T.textDim }]}>SETUP KEY</Text>
      <TouchableOpacity
        style={[styles.secretRow, { backgroundColor: T.surface, borderColor: T.border }]}
        onPress={async () => {
          await Clipboard.setStringAsync(secret);
          setCopiedSecret(true);
        }}
      >
        <Key size={16} color={T.textDim} weight="duotone" />
        <Text style={[styles.secretText, { color: T.textBright }]} numberOfLines={1}>
          {secret}
        </Text>
        {copiedSecret ? (
          <Check size={16} color={color} weight="bold" />
        ) : (
          <Copy size={16} color={T.textDim} weight="duotone" />
        )}
      </TouchableOpacity>

      <Text style={[styles.label, { color: T.textDim, marginTop: 16 }]}>VERIFICATION CODE</Text>
      <TextInput
        value={code}
        onChangeText={setCode}
        placeholder="6-digit code"
        placeholderTextColor={T.textDim}
        keyboardType="number-pad"
        style={[
          styles.input,
          { color: T.textBright, backgroundColor: T.surface, borderColor: T.border },
        ]}
        maxLength={8}
      />

      {error ? <Text style={[styles.errText, { color: "#FA5252" }]}>{error}</Text> : null}

      <TouchableOpacity
        style={[styles.btn, { backgroundColor: code.trim().length >= 6 ? color : T.surfaceHover }]}
        onPress={confirm}
        disabled={code.trim().length < 6 || submitting}
      >
        {submitting ? (
          <ActivityIndicator size="small" color="#fff" />
        ) : (
          <Text style={[styles.btnText, { color: code.trim().length >= 6 ? "#fff" : T.textDim }]}>
            Verify & enable
          </Text>
        )}
      </TouchableOpacity>
    </ScrollView>
  );
}

function friendly(err: any): string {
  const msg = err?.message || "Something went wrong";
  const match = msg.includes("[") ? msg.match(/\] (.+)/) : null;
  return match ? match[1] : msg;
}

const styles = StyleSheet.create({
  center: { padding: 40, alignItems: "center", gap: 16 },
  content: { padding: 20, gap: 12 },
  headerWrap: { alignItems: "center", gap: 6, marginBottom: 6 },
  title: { fontSize: 17, fontFamily: FONT.semibold },
  subtitle: { fontSize: 13, fontFamily: FONT.regular, textAlign: "center", lineHeight: 19 },
  qrWrap: { alignSelf: "center", padding: 12, borderRadius: 12 },
  label: { fontSize: 11, fontFamily: FONT.semibold, letterSpacing: 0.8 },
  secretRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 14,
    height: 46,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
  },
  secretText: { flex: 1, fontSize: 14, fontFamily: FONT.semibold, letterSpacing: 1 },
  input: {
    height: 48,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 14,
    fontSize: 18,
    fontFamily: FONT.semibold,
    letterSpacing: 3,
  },
  errText: { fontSize: 13, fontFamily: FONT.medium, textAlign: "center" },
  btn: {
    height: 48,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 8,
  },
  btnText: { fontSize: 15, fontFamily: FONT.semibold, color: "#fff" },
  codesBox: {
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 16,
    gap: 8,
    alignItems: "center",
  },
  codeText: { fontSize: 15, fontFamily: FONT.semibold, letterSpacing: 1.5 },
  copyRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    height: 44,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
  },
  copyText: { fontSize: 14, fontFamily: FONT.medium },
});
