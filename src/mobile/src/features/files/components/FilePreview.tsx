import React, { useEffect, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  TouchableOpacity,
  Platform,
} from "react-native";
import { Image } from "expo-image";
import { WebView } from "react-native-webview";
import { useAudioPlayer, useAudioPlayerStatus } from "expo-audio";
import { Play, Pause, FileText, ArrowsOut } from "phosphor-react-native";
import { useTheme } from "@shared/hooks/useTheme";
import { FONT } from "@theme/typography";
import { buildFileUrl, assetAuthHeaders } from "@features/files/fileUrls";
import { FILE_COLORS } from "@theme/theme";
import { FullscreenViewer } from "@features/files/components/FullscreenViewer";

const TEXT_EXTS = new Set([
  "txt",
  "md",
  "markdown",
  "json",
  "csv",
  "tsv",
  "log",
  "xml",
  "yaml",
  "yml",
  "ini",
  "toml",
  "js",
  "jsx",
  "ts",
  "tsx",
  "py",
  "go",
  "rs",
  "java",
  "kt",
  "c",
  "cc",
  "cpp",
  "h",
  "hpp",
  "cs",
  "rb",
  "php",
  "sh",
  "bash",
  "sql",
  "css",
  "scss",
  "html",
  "svg",
]);

const MONO = Platform.OS === "ios" ? "Menlo" : "monospace";

type PreviewKind = "image" | "audio" | "pdf" | "text" | "video" | "other";

function previewKind(mimeType: string, ext: string): PreviewKind {
  if (mimeType.startsWith("image/")) return "image";
  if (mimeType.startsWith("audio/")) return "audio";
  if (mimeType.startsWith("video/")) return "video";
  if (mimeType.includes("pdf") || ext === "pdf") return "pdf";
  if (
    mimeType.startsWith("text/") ||
    mimeType.includes("json") ||
    mimeType.includes("xml") ||
    mimeType.includes("javascript") ||
    TEXT_EXTS.has(ext)
  ) {
    return "text";
  }
  return "other";
}

export function FilePreview({
  fileId,
  filename,
  mimeType,
  ext,
  organizationId,
}: {
  fileId: string;
  filename: string;
  mimeType: string;
  ext: string;
  organizationId: string;
}) {
  const kind = previewKind(mimeType, ext);
  const uri = buildFileUrl(organizationId, fileId);
  const headers = assetAuthHeaders();
  const [fullscreen, setFullscreen] = useState(false);

  if (kind === "image") {
    return (
      <>
        <TouchableOpacity
          activeOpacity={0.9}
          onPress={() => setFullscreen(true)}
          style={styles.imageWrap}
        >
          <Image
            source={{ uri, headers }}
            style={styles.image}
            contentFit="contain"
            transition={150}
          />
          <View style={styles.expandBadge} pointerEvents="none">
            <ArrowsOut size={16} color="#fff" weight="bold" />
          </View>
        </TouchableOpacity>
        <FullscreenViewer
          visible={fullscreen}
          onClose={() => setFullscreen(false)}
          uri={uri}
          headers={headers}
          kind="image"
        />
      </>
    );
  }
  if (kind === "audio") return <AudioPreview uri={uri} filename={filename} />;
  if (kind === "pdf") {
    return (
      <>
        <PdfPreview uri={uri} onExpand={() => setFullscreen(true)} />
        <FullscreenViewer
          visible={fullscreen}
          onClose={() => setFullscreen(false)}
          uri={uri}
          headers={headers}
          kind="pdf"
        />
      </>
    );
  }
  if (kind === "text") return <TextPreview uri={uri} />;
  return <IconPreview ext={ext} />;
}

function PdfPreview({ uri, onExpand }: { uri: string; onExpand: () => void }) {
  const T = useTheme();
  return (
    <View style={[styles.frame, { borderColor: T.border }]}>
      <WebView
        source={{ uri, headers: assetAuthHeaders() }}
        style={{ flex: 1, backgroundColor: T.surface }}
        originWhitelist={["*"]}
        startInLoadingState
        renderLoading={() => (
          <View style={styles.centered}>
            <ActivityIndicator color={T.accent} />
          </View>
        )}
      />
      <TouchableOpacity
        style={styles.expandBadgeTop}
        onPress={onExpand}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      >
        <ArrowsOut size={16} color="#fff" weight="bold" />
      </TouchableOpacity>
    </View>
  );
}

function TextPreview({ uri }: { uri: string }) {
  const T = useTheme();
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // Not an RPC: asset read from the login server, authenticated by
        // assetAuthHeaders instead of the Connect transport.
        // eslint-disable-next-line no-restricted-globals
        const res = await fetch(uri, { headers: assetAuthHeaders() });
        if (!res.ok) throw new Error(String(res.status));
        const body = await res.text();
        if (!cancelled) setText(body.slice(0, 100_000));
      } catch {
        if (!cancelled) setError(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [uri]);

  if (error) return <IconPreview ext="txt" />;
  if (text === null) {
    return (
      <View style={[styles.frame, styles.centered, { borderColor: T.border }]}>
        <ActivityIndicator color={T.accent} />
      </View>
    );
  }
  return (
    <View style={[styles.frame, { borderColor: T.border, backgroundColor: T.pageBg }]}>
      <ScrollView contentContainerStyle={styles.textScroll}>
        <Text style={[styles.textBody, { color: T.textBright }]} selectable>
          {text}
        </Text>
      </ScrollView>
    </View>
  );
}

function AudioPreview({ uri, filename }: { uri: string; filename: string }) {
  const T = useTheme();
  const player = useAudioPlayer({ uri, headers: assetAuthHeaders() });
  const status = useAudioPlayerStatus(player);
  const duration = status.duration || 0;
  const position = status.currentTime || 0;
  const pct = duration > 0 ? Math.min(100, (position / duration) * 100) : 0;

  return (
    <View style={styles.audioWrap}>
      <View style={[styles.audioArt, { backgroundColor: T.accentSoft }]}>
        <FileText size={40} color={T.accent} weight="duotone" />
      </View>
      <Text style={[styles.audioName, { color: T.textBright }]} numberOfLines={1}>
        {filename}
      </Text>
      <View style={styles.audioControls}>
        <TouchableOpacity
          style={[styles.audioBtn, { backgroundColor: T.accent }]}
          onPress={() => (status.playing ? player.pause() : player.play())}
        >
          {status.playing ? (
            <Pause size={22} color="#fff" weight="fill" />
          ) : (
            <Play size={22} color="#fff" weight="fill" />
          )}
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <View style={[styles.audioTrack, { backgroundColor: T.border }]}>
            <View style={[styles.audioFill, { backgroundColor: T.accent, width: `${pct}%` }]} />
          </View>
          <Text style={[styles.audioTime, { color: T.textDim }]}>
            {fmtTime(position)} / {fmtTime(duration)}
          </Text>
        </View>
      </View>
    </View>
  );
}

function IconPreview({ ext }: { ext: string }) {
  const color = FILE_COLORS[ext.toLowerCase()] ?? FILE_COLORS.default;
  return (
    <View style={[styles.iconBox, { backgroundColor: color + "18" }]}>
      <Text style={[styles.iconExt, { color }]}>{ext.toUpperCase() || "FILE"}</Text>
    </View>
  );
}

function fmtTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

const styles = StyleSheet.create({
  imageWrap: { width: "100%", position: "relative" },
  image: { width: "100%", height: 260, borderRadius: 12 },
  expandBadge: {
    position: "absolute",
    right: 10,
    bottom: 10,
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: "rgba(0,0,0,0.5)",
    alignItems: "center",
    justifyContent: "center",
  },
  expandBadgeTop: {
    position: "absolute",
    right: 10,
    top: 10,
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: "rgba(0,0,0,0.5)",
    alignItems: "center",
    justifyContent: "center",
  },
  frame: {
    width: "100%",
    height: 320,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: "hidden",
  },
  centered: { flex: 1, alignItems: "center", justifyContent: "center" },
  textScroll: { padding: 12 },
  textBody: { fontSize: 12, fontFamily: MONO, lineHeight: 18 },
  audioWrap: { alignItems: "center", gap: 14, width: "100%", paddingVertical: 8 },
  audioArt: {
    width: 80,
    height: 80,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  audioName: { fontSize: 14, fontFamily: FONT.semibold, maxWidth: "90%" },
  audioControls: { flexDirection: "row", alignItems: "center", gap: 14, width: "100%" },
  audioBtn: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: "center",
    justifyContent: "center",
  },
  audioTrack: { height: 4, borderRadius: 2, overflow: "hidden" },
  audioFill: { height: 4, borderRadius: 2 },
  audioTime: { fontSize: 11, fontFamily: FONT.regular, marginTop: 6 },
  iconBox: {
    width: 80,
    height: 80,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  iconExt: { fontSize: 18, fontFamily: FONT.bold, letterSpacing: 1 },
});
