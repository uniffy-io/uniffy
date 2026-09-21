import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { View, Text, StyleSheet, ActivityIndicator } from "react-native";
import { useVideoPlayer, VideoView } from "expo-video";
import { PlaybackStatus, TranscodeStatus } from "@uniffy/proto/files/v1/files_pb";
import { useTheme } from "@shared/hooks/useTheme";
import { assetAuthHeaders, buildMediaUrl, buildPlaybackUrl } from "@features/files/fileUrls";
import { useFile } from "@features/files/useFiles";
import { refreshSession } from "@core/auth/refresh";

export function VideoPreview({
  fileId,
  organizationId,
}: {
  fileId: string;
  organizationId: string;
}) {
  const { data } = useFile(fileId);
  return (
    <VideoContent
      key={`${organizationId}:${fileId}:${data?.version ?? 0}`}
      fileId={fileId}
      organizationId={organizationId}
    />
  );
}

function VideoContent({ fileId, organizationId }: { fileId: string; organizationId: string }) {
  const T = useTheme();
  const { data: file, refetch } = useFile(fileId);
  const [failed, setFailed] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const [fallback, setFallback] = useState(false);
  const [authRevision, setAuthRevision] = useState(0);
  const retried = useRef(new Set<string>());
  const handlingError = useRef(false);
  const alive = useRef(true);
  const preparing =
    failed &&
    (file?.playbackStatus === PlaybackStatus.PENDING ||
      file?.playbackStatus === PlaybackStatus.PROCESSING ||
      file?.transcodeStatus === TranscodeStatus.PENDING ||
      file?.transcodeStatus === TranscodeStatus.PROCESSING);
  const uri =
    fallback && file
      ? buildPlaybackUrl(organizationId, fileId, file.version)
      : `${buildMediaUrl(organizationId, fileId)}?v=${file?.version ?? 0}`;
  const source = useMemo(
    () => ({
      uri: `${uri}${uri.includes("?") ? "&" : "?"}_r=${authRevision}`,
      headers: assetAuthHeaders(),
    }),
    [uri, authRevision],
  );
  const player = useVideoPlayer(null);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const handleError = useCallback(async () => {
    if (handlingError.current || !alive.current) return;
    handlingError.current = true;
    try {
      const mode = fallback ? "fallback" : "original";
      if (!retried.current.has(mode)) {
        retried.current.add(mode);
        try {
          if (!(await refreshSession())) throw new Error("Session unavailable");
          const result = await refetch();
          if (result.error) throw result.error;
          if (alive.current) setAuthRevision((value) => value + 1);
        } catch {
          if (alive.current) setUnavailable(true);
        }
        return;
      }
      const result = await refetch();
      if (!alive.current) return;
      if (result.error) {
        setUnavailable(true);
      } else if (!fallback && result.data?.playbackStatus === PlaybackStatus.COMPLETED) {
        setFallback(true);
      } else {
        setFailed(true);
      }
    } finally {
      handlingError.current = false;
    }
  }, [fallback, refetch]);

  useEffect(() => {
    const listener = player.addListener("statusChange", ({ status }) => {
      if (status === "error") void handleError();
      if (status === "readyToPlay") setFailed(false);
    });
    return () => listener.remove();
  }, [player, handleError]);

  useEffect(() => {
    let cancelled = false;
    void player.replaceAsync(source).catch(() => {
      if (!cancelled) void handleError();
    });
    return () => {
      cancelled = true;
    };
  }, [player, source, handleError]);

  useEffect(() => {
    if (!preparing || unavailable) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      const result = await refetch();
      if (cancelled) return;
      if (result.error) {
        setUnavailable(true);
        return;
      }
      if (result.data?.playbackStatus === PlaybackStatus.COMPLETED) {
        setFallback(true);
        setFailed(false);
      }
      timer = setTimeout(poll, 5000);
    };
    timer = setTimeout(poll, 5000);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [preparing, unavailable, refetch]);

  if (unavailable)
    return (
      <Text style={{ color: T.textDim }}>
        Unable to load video. Check your connection and access.
      </Text>
    );
  if (preparing)
    return (
      <View style={styles.pending}>
        <ActivityIndicator color={T.accent} />
        <Text style={{ color: T.textDim }}>
          Preparing this video. Longer videos can take a few minutes.
        </Text>
      </View>
    );
  if (failed)
    return (
      <Text style={{ color: T.textDim }}>This video cannot play here. Download it to watch.</Text>
    );
  return (
    <VideoView
      player={player}
      style={styles.player}
      nativeControls
      contentFit="contain"
      fullscreenOptions={{ enable: true }}
    />
  );
}

const styles = StyleSheet.create({
  player: { width: "100%", height: 260, borderRadius: 12 },
  pending: { padding: 24, gap: 12, alignItems: "center" },
});
