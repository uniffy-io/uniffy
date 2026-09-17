/** Resolves a user's avatar URL against the org member directory, which is the authority on
 *  who has one. A user the directory does not cover gets `null` (initials) rather than a URL
 *  that is guaranteed to 404. Callers keep `onError` as a race guard for deleted avatars.
 *
 *  The directory entry's URL is rebuilt at the caller's variant rather than used verbatim:
 *  the server picks one size for every consumer, so a 40px avatar would otherwise load the
 *  same bytes as a 16px one. The upload's content hash is carried over so the browser still
 *  drops the old image the moment someone changes their avatar. */

import { useEffect, useMemo } from "react";
import { useAppDispatch, useAppSelector } from "@/app/hooks";
import { DIRECTORY_MEMBERS_PAGE_SIZE, fetchMembers } from "@/features/admin/store/adminThunks";
import { avatarVersionFromUrl, buildAvatarUrl, type AvatarVariant } from "@/shared/utils/fileUrls";
import type { SerializedMemberInfo } from "@/features/admin/store/adminSlice";

// A page full of avatars mounts every effect in one commit, before any of them can
// observe the pending flag, so the single-flight latch has to live at module scope.
let directoryInFlight = false;

export function useAvatarUrl(userId: string, size: AvatarVariant = "sm"): string | null {
  const dispatch = useAppDispatch();
  const members = useAppSelector((state) => state.admin.members) as SerializedMemberInfo[];
  const membersFetched = useAppSelector((state) => state.admin.membersFetched);
  const membersLoading = useAppSelector((state) => state.admin.membersLoading);
  const currentUser = useAppSelector((state) => state.auth.user);
  const organizationId = useAppSelector((state) => state.auth.currentOrganizationId);

  useEffect(() => {
    // No org context (e.g. a pure platform operator): there is no member
    // directory to resolve against, so stay on the initials fallback.
    if (!userId || !organizationId || membersFetched || membersLoading || directoryInFlight) {
      return;
    }
    directoryInFlight = true;
    void dispatch(fetchMembers({ pageSize: DIRECTORY_MEMBERS_PAGE_SIZE })).finally(() => {
      directoryInFlight = false;
    });
  }, [dispatch, userId, organizationId, membersFetched, membersLoading]);

  return useMemo(() => {
    if (!userId) return null;

    if (currentUser && currentUser.id === userId) {
      return currentUser.hasAvatar
        ? buildAvatarUrl(userId, size, avatarVersionFromUrl(currentUser.avatarUrl))
        : null;
    }

    const member = members.find((m) => m.userId === userId);
    if (!member?.hasAvatar) return null;

    return buildAvatarUrl(userId, size, avatarVersionFromUrl(member.avatarUrl));
  }, [userId, size, members, currentUser]);
}
