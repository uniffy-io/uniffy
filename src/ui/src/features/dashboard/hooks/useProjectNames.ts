import { useEffect, useState } from "react";
import { useAppSelector } from "@/app/hooks";
import { getMentionState, onMentionStateChange } from "@/components/mention/mentionStateEmitter";
import { MentionAvailability } from "@/components/mention/types";
import { resolveUrnBatched } from "@/components/mention/useBatchedSubjectResolver";

const projectUrn = (id: string) => `urn:uniffy:content:PROJECT:${id}`;

/**
 * Names for projects a filter picked, from the shared mention cache: the project list holds only
 * its first page, and a project the viewer lost access to resolves to no name at all.
 */
export function useProjectNames(ids: readonly string[]): Record<string, string> {
  const organizationId = useAppSelector((state) => state.auth.currentOrganizationId);
  const loaded = useAppSelector((state) => state.projects.projects);
  const [, setVersion] = useState(0);
  const key = [...new Set(ids)].sort().join(",");

  useEffect(() => {
    if (!organizationId || !key) return;
    const urns = new Set(key.split(",").map(projectUrn));
    const bump = () => setVersion((version) => version + 1);
    const unsubscribe = onMentionStateChange((urn) => {
      if (urns.has(urn)) bump();
    });
    for (const urn of urns) {
      if (!getMentionState(urn)) {
        resolveUrnBatched(urn, organizationId)
          .then(bump)
          .catch(() => {});
      }
    }
    return unsubscribe;
  }, [key, organizationId]);

  const names: Record<string, string> = {};
  for (const id of ids) {
    const state = getMentionState(projectUrn(id));
    if (state?.availability && state.availability !== MentionAvailability.Available) continue;
    const name = state?.title || loaded[id]?.name;
    if (name) names[id] = name;
  }
  return names;
}
