import { useCallback } from "react";
import { useAppDispatch } from "@/app/hooks";
import { updateUser } from "@/features/auth/store/authSlice";
import { usersApi } from "@/features/settings/api/usersApi";

/** Upload and delete for the signed-in user's avatar, shared by settings and onboarding. */
export function useAvatarActions() {
  const dispatch = useAppDispatch();

  const uploadAvatar = useCallback(
    async (file: File) => {
      const imageData = new Uint8Array(await file.arrayBuffer());
      const profile = await usersApi.uploadAvatar(imageData, file.name);
      // hasAvatar gates every avatar consumer; flip it locally so they stop rendering initials before the next GetCurrentUser.
      dispatch(updateUser({ avatarUrl: profile.avatarUrl, hasAvatar: true }));
    },
    [dispatch],
  );

  const deleteAvatar = useCallback(async () => {
    await usersApi.deleteAvatar();
    dispatch(updateUser({ avatarUrl: "", hasAvatar: false }));
  }, [dispatch]);

  return { uploadAvatar, deleteAvatar };
}
