import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { filesApi } from "@/features/files/api/filesApi";
import { refreshAccessToken } from "@/config/api";
import {
  buildFileUrl,
  buildMediaUrl,
  buildPlaybackUrl,
  parseFileUrl,
  parseMediaUrl,
} from "@/shared/utils/fileUrls";
import { playbackAfterError, playbackSourceType } from "@/features/files/utils/playbackSource";
import type { PlaybackFile } from "@/features/files/utils/playbackSource";

type PlaybackKind = "original" | "fallback" | "preparing" | "unsupported" | "unavailable";
interface PlaybackSource {
  kind: PlaybackKind;
  src: string;
  type: string;
  version?: number;
}

export function usePlaybackSource(original: string, mimeType = "video/mp4", version?: number) {
  const [source, setSource] = useState<PlaybackSource>(() => ({
    kind: "original",
    src: original,
    type: playbackSourceType(mimeType),
    version,
  }));
  const busy = useRef(false);
  const active = useRef(true);
  const authRetries = useRef(new Set<PlaybackKind>());
  const identity = useMemo(() => parseMediaUrl(original) ?? parseFileUrl(original), [original]);
  const organizationId = identity?.organizationId;
  const fileId = identity?.fileId;

  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);

  const acceptFile = useCallback(
    (file: PlaybackFile) => {
      if (!organizationId || !fileId) return;
      setSource((previous) => {
        if (previous.version !== undefined && file.version !== previous.version) {
          return {
            kind: "original",
            src: `${buildMediaUrl(organizationId, fileId)}?v=${file.version}`,
            type: playbackSourceType(file.mimeType),
            version: file.version,
          };
        }
        const kind = playbackAfterError(file);
        return {
          kind,
          version: file.version,
          src:
            kind === "fallback"
              ? buildPlaybackUrl(organizationId, fileId, file.version)
              : previous.src,
          type: kind === "fallback" ? "video/mp4" : previous.type,
        };
      });
    },
    [organizationId, fileId],
  );

  const onError = useCallback(
    async (code?: number) => {
      if (busy.current) return;
      busy.current = true;
      try {
        if (!organizationId || !fileId) {
          if (active.current) setSource((previous) => ({ ...previous, kind: "unsupported" }));
          return;
        }
        if (!authRetries.current.has(source.kind)) {
          authRetries.current.add(source.kind);
          await refreshAccessToken();
          const response = await filesApi.getFile({ organizationId, fileId });
          if (!response.file) throw new Error("File unavailable");
          if (active.current)
            setSource((previous) => ({
              ...previous,
              version: response.file!.version,
              type:
                previous.kind === "fallback"
                  ? "video/mp4"
                  : playbackSourceType(response.file!.mimeType),
              src:
                previous.kind === "fallback"
                  ? `${buildPlaybackUrl(organizationId, fileId, response.file!.version)}?_r=${Date.now()}`
                  : `${buildMediaUrl(organizationId, fileId)}?v=${response.file!.version}&_r=${Date.now()}`,
            }));
          return;
        }
        if (code !== 3 && code !== 4) {
          if (active.current) setSource((previous) => ({ ...previous, kind: "unavailable" }));
          return;
        }
        if (source.kind === "fallback") {
          if (active.current) setSource((previous) => ({ ...previous, kind: "unsupported" }));
          return;
        }
        const response = await filesApi.getFile({ organizationId, fileId });
        if (!response.file) throw new Error("File unavailable");
        if (active.current) acceptFile(response.file);
      } catch {
        if (active.current) setSource((previous) => ({ ...previous, kind: "unavailable" }));
      } finally {
        busy.current = false;
      }
    },
    [source.kind, organizationId, fileId, acceptFile],
  );

  useEffect(() => {
    if (source.kind !== "preparing" || !organizationId || !fileId) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const response = await filesApi.getFile({ organizationId, fileId });
        if (!response.file) throw new Error("File unavailable");
        if (!cancelled) acceptFile(response.file);
      } catch {
        if (!cancelled) setSource((previous) => ({ ...previous, kind: "unavailable" }));
      }
      if (!cancelled) timer = setTimeout(poll, 5000);
    };
    timer = setTimeout(poll, 5000);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [source.kind, organizationId, fileId, acceptFile]);

  return {
    ...source,
    onError,
    downloadUrl: identity ? buildFileUrl(identity.organizationId, identity.fileId) : original,
  };
}
