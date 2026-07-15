import React, { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Platform,
  ActivityIndicator,
  Modal,
  TextInput,
  Alert,
} from "react-native";
import { useQuery } from "@tanstack/react-query";
import * as Clipboard from "expo-clipboard";
import {
  ShieldCheck,
  ShieldWarning,
  ArrowsClockwise,
  Trash,
  X,
  Check,
} from "phosphor-react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { DomainHeader } from "@shared/components/DomainHeader";
import { MfaEnrollFlow } from "@features/auth/components/MfaEnrollFlow";
import { useTheme } from "@shared/hooks/useTheme";
import { BOTTOM_NAV_HEIGHT } from "@theme/theme";
import type { ThemeColors } from "@theme/theme";
import { FONT } from "@theme/typography";
import { useAuth } from "@core/providers/auth-context";
import { mfaApi } from "@features/auth/mfaApi";

type CodeAction = "disable" | "regenerate" | null;

export default function SecurityScreen() {
  const T = useTheme();
  const insets = useSafeAreaInsets();
  const bottomPad =
    Platform.OS === "web" ? BOTTOM_NAV_HEIGHT + 34 : BOTTOM_NAV_HEIGHT + insets.bottom;
  const { isAuthenticated } = useAuth();
  const [enrolling, setEnrolling] = useState(false);
  const [codeAction, setCodeAction] = useState<CodeAction>(null);
  const [newCodes, setNewCodes] = useState<string[] | null>(null);

  const status = useQuery({
    queryKey: ["mfa-status"],
    enabled: isAuthenticated,
    queryFn: () => mfaApi.getMfaStatus(),
  });

  const enabled = status.data?.enabled ?? false;
  const remaining = status.data?.remainingRecoveryCodes ?? 0;

  if (enrolling) {
    return (
      <View style={[styles.container, { backgroundColor: T.pageBg }]}>
        <DomainHeader title="Two-factor setup" color={T.accent} icon="lock" />
        <MfaEnrollFlow
          color={T.accent}
          onDone={() => {
            setEnrolling(false);
            status.refetch();
          }}
        />
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: T.pageBg }]}>
      <DomainHeader title="Security" color={T.accent} icon="lock" />

      {status.isLoading ? (
        <View style={styles.loadingWrap}>
          <ActivityIndicator size="large" color={T.accent} />
        </View>
      ) : (
        <ScrollView contentContainerStyle={[styles.content, { paddingBottom: bottomPad }]}>
          <Text style={[styles.sectionLabel, { color: T.textDim }]}>TWO-FACTOR AUTHENTICATION</Text>

          <View style={[styles.card, { backgroundColor: T.surface, borderColor: T.border }]}>
            <View style={styles.statusRow}>
              <View
                style={[
                  styles.statusIcon,
                  { backgroundColor: enabled ? "#10b98122" : T.surfaceHover },
                ]}
              >
                {enabled ? (
                  <ShieldCheck size={22} color="#10b981" weight="duotone" />
                ) : (
                  <ShieldWarning size={22} color={T.textDim} weight="duotone" />
                )}
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.statusTitle, { color: T.textBright }]}>
                  {enabled ? "Enabled" : "Not enabled"}
                </Text>
                <Text style={[styles.statusSub, { color: T.textDim }]}>
                  {enabled
                    ? "Your account is protected with an authenticator app"
                    : "Add a second factor to protect your account"}
                </Text>
              </View>
            </View>

            {!enabled ? (
              <TouchableOpacity
                style={[styles.primaryBtn, { backgroundColor: T.accent }]}
                onPress={() => setEnrolling(true)}
                activeOpacity={0.8}
              >
                <Text style={styles.primaryBtnText}>Enable two-factor</Text>
              </TouchableOpacity>
            ) : null}
          </View>

          {enabled ? (
            <>
              <View
                style={[
                  styles.recoveryRow,
                  { backgroundColor: T.surface, borderColor: T.border },
                  remaining < 3 ? { borderColor: "#f59e0b" } : null,
                ]}
              >
                <Text style={[styles.recoveryLabel, { color: T.text }]}>Recovery codes left</Text>
                <Text
                  style={[
                    styles.recoveryCount,
                    { color: remaining < 3 ? "#f59e0b" : T.textBright },
                  ]}
                >
                  {remaining}
                </Text>
              </View>
              {remaining < 3 ? (
                <Text style={[styles.warnText, { color: "#f59e0b" }]}>
                  You are running low on recovery codes. Regenerate to get a fresh set.
                </Text>
              ) : null}

              <TouchableOpacity
                style={[styles.actionRow, { backgroundColor: T.surface, borderColor: T.border }]}
                onPress={() => setCodeAction("regenerate")}
                activeOpacity={0.7}
              >
                <ArrowsClockwise size={18} color={T.text} weight="duotone" />
                <Text style={[styles.actionText, { color: T.textBright }]}>
                  Regenerate recovery codes
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.actionRow, { backgroundColor: T.surface, borderColor: T.border }]}
                onPress={() => setCodeAction("disable")}
                activeOpacity={0.7}
              >
                <Trash size={18} color="#FA5252" weight="duotone" />
                <Text style={[styles.actionText, { color: "#FA5252" }]}>Disable two-factor</Text>
              </TouchableOpacity>
            </>
          ) : null}
        </ScrollView>
      )}

      <CodePromptModal
        visible={codeAction !== null}
        T={T}
        title={codeAction === "disable" ? "Disable two-factor" : "Regenerate recovery codes"}
        actionLabel={codeAction === "disable" ? "Disable" : "Regenerate"}
        danger={codeAction === "disable"}
        onClose={() => setCodeAction(null)}
        onSubmit={async (code) => {
          if (codeAction === "disable") {
            await mfaApi.disableMfa(code);
            setCodeAction(null);
            status.refetch();
            Alert.alert("Two-factor disabled", "Your account no longer requires a second factor.");
          } else {
            const res = await mfaApi.regenerateRecoveryCodes(code);
            setCodeAction(null);
            setNewCodes(res.recoveryCodes);
            status.refetch();
          }
        }}
      />

      <RecoveryCodesModal
        codes={newCodes}
        T={T}
        accent={T.accent}
        onClose={() => setNewCodes(null)}
      />
    </View>
  );
}

function CodePromptModal({
  visible,
  T,
  title,
  actionLabel,
  danger,
  onClose,
  onSubmit,
}: {
  visible: boolean;
  T: ThemeColors;
  title: string;
  actionLabel: string;
  danger?: boolean;
  onClose: () => void;
  onSubmit: (code: string) => Promise<void>;
}) {
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (code.trim().length < 6) return;
    setBusy(true);
    setError(null);
    try {
      await onSubmit(code.trim());
      setCode("");
    } catch (err: any) {
      const msg = err?.message || "Invalid code";
      const match = msg.includes("[") ? msg.match(/\] (.+)/) : null;
      setError(match ? match[1] : msg);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.modalBackdrop}>
        <View style={[styles.promptCard, { backgroundColor: T.surface }]}>
          <Text style={[styles.promptTitle, { color: T.textBright }]}>{title}</Text>
          <Text style={[styles.promptSub, { color: T.textDim }]}>
            Enter your current authenticator code to continue.
          </Text>
          <TextInput
            value={code}
            onChangeText={setCode}
            placeholder="6-digit code"
            placeholderTextColor={T.textDim}
            keyboardType="number-pad"
            style={[
              styles.promptInput,
              { color: T.textBright, backgroundColor: T.bg, borderColor: T.border },
            ]}
            maxLength={8}
            autoFocus
          />
          {error ? <Text style={[styles.promptErr, { color: "#FA5252" }]}>{error}</Text> : null}
          <View style={styles.promptActions}>
            <TouchableOpacity style={styles.promptCancel} onPress={onClose}>
              <Text style={[styles.promptCancelText, { color: T.textDim }]}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[
                styles.promptConfirm,
                {
                  backgroundColor: danger ? "#FA5252" : T.accent,
                  opacity: code.trim().length < 6 ? 0.4 : 1,
                },
              ]}
              onPress={submit}
              disabled={code.trim().length < 6 || busy}
            >
              {busy ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Text style={styles.promptConfirmText}>{actionLabel}</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function RecoveryCodesModal({
  codes,
  T,
  accent,
  onClose,
}: {
  codes: string[] | null;
  T: ThemeColors;
  accent: string;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <Modal visible={!!codes} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.modalBackdrop}>
        <View style={[styles.promptCard, { backgroundColor: T.surface }]}>
          <View style={styles.codesHeader}>
            <Text style={[styles.promptTitle, { color: T.textBright }]}>New recovery codes</Text>
            <TouchableOpacity onPress={onClose} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <X size={18} color={T.textDim} weight="bold" />
            </TouchableOpacity>
          </View>
          <Text style={[styles.promptSub, { color: T.textDim }]}>
            Your old codes no longer work. Save these somewhere safe.
          </Text>
          <View style={[styles.codesBox, { backgroundColor: T.bg, borderColor: T.border }]}>
            {(codes ?? []).map((c) => (
              <Text key={c} style={[styles.codeText, { color: T.textBright }]}>
                {c}
              </Text>
            ))}
          </View>
          <TouchableOpacity
            style={[styles.copyRow, { borderColor: T.border }]}
            onPress={async () => {
              await Clipboard.setStringAsync((codes ?? []).join("\n"));
              setCopied(true);
            }}
          >
            {copied ? <Check size={16} color={accent} weight="bold" /> : null}
            <Text style={[styles.copyText, { color: copied ? accent : T.text }]}>
              {copied ? "Copied" : "Copy all codes"}
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  loadingWrap: { flex: 1, alignItems: "center", justifyContent: "center" },
  content: { padding: 20 },
  sectionLabel: { fontSize: 11, fontFamily: FONT.semibold, letterSpacing: 0.8, marginBottom: 10 },
  card: { borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, padding: 16, gap: 14 },
  statusRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  statusIcon: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  statusTitle: { fontSize: 15, fontFamily: FONT.semibold },
  statusSub: { fontSize: 12, fontFamily: FONT.regular, marginTop: 2, lineHeight: 17 },
  primaryBtn: { height: 46, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  primaryBtnText: { fontSize: 15, fontFamily: FONT.semibold, color: "#fff" },
  recoveryRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 16,
    paddingVertical: 14,
    marginTop: 18,
  },
  recoveryLabel: { fontSize: 14, fontFamily: FONT.medium },
  recoveryCount: { fontSize: 18, fontFamily: FONT.bold },
  warnText: { fontSize: 12, fontFamily: FONT.regular, marginTop: 8, lineHeight: 17 },
  actionRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 16,
    paddingVertical: 15,
    marginTop: 12,
  },
  actionText: { fontSize: 15, fontFamily: FONT.medium },
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.6)",
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  promptCard: { width: "100%", borderRadius: 16, padding: 20, gap: 12 },
  codesHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  promptTitle: { fontSize: 16, fontFamily: FONT.bold },
  promptSub: { fontSize: 13, fontFamily: FONT.regular, lineHeight: 18 },
  promptInput: {
    height: 48,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 14,
    fontSize: 18,
    fontFamily: FONT.semibold,
    letterSpacing: 3,
  },
  promptErr: { fontSize: 13, fontFamily: FONT.medium },
  promptActions: { flexDirection: "row", gap: 10, marginTop: 4 },
  promptCancel: {
    flex: 1,
    height: 46,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  promptCancelText: { fontSize: 15, fontFamily: FONT.medium },
  promptConfirm: {
    flex: 1,
    height: 46,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  promptConfirmText: { fontSize: 15, fontFamily: FONT.semibold, color: "#fff" },
  codesBox: {
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 14,
    gap: 7,
    alignItems: "center",
  },
  codeText: { fontSize: 14, fontFamily: FONT.semibold, letterSpacing: 1.2 },
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
