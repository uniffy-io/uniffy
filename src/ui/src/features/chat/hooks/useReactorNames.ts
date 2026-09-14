import { useEffect, useMemo, useState } from "react";
import { useAppSelector } from "@/app/hooks";
import { useBatchedSubjectResolver } from "@/components/mention/useBatchedSubjectResolver";
import { MentionAvailability } from "@/components/mention/types";
import type { ChatChannelMember } from "@/features/chat/types";

const EMPTY_MEMBERS: ChatChannelMember[] = [];

export function useReactorNames(
  channelId: string,
  ids: string[],
  enabled: boolean,
): Record<string, string> {
  const organizationId = useAppSelector((state) => state.auth.currentOrganizationId);
  const members = useAppSelector(
    (state) => state.chatChannels.channelMembers[channelId] ?? EMPTY_MEMBERS,
  );
  const resolve = useBatchedSubjectResolver();
  const [resolved, setResolved] = useState<{
    organizationId: string;
    names: Record<string, string>;
  } | null>(null);
  const rosterNames = useMemo(() => {
    const names: Record<string, string> = {};
    for (const member of members) {
      if (member.userId && member.displayName) names[member.userId] = member.displayName;
    }
    return names;
  }, [members]);

  useEffect(() => {
    if (!enabled || !organizationId) return;
    let cancelled = false;
    void Promise.all(
      ids
        .filter((id) => !rosterNames[id])
        .map(async (id) => {
          const preview = await resolve(`urn:uniffy:content:USER:${id}`);
          return [
            id,
            preview?.availability === MentionAvailability.Available ? preview.title : "",
          ] as const;
        }),
    ).then((entries) => {
      if (!cancelled)
        setResolved({
          organizationId,
          names: Object.fromEntries(entries.filter(([, name]) => name)),
        });
    });
    return () => {
      cancelled = true;
    };
  }, [enabled, ids, organizationId, resolve, rosterNames]);

  return useMemo(
    () => ({
      ...(resolved?.organizationId === organizationId ? resolved?.names : {}),
      ...rosterNames,
    }),
    [rosterNames, resolved, organizationId],
  );
}
