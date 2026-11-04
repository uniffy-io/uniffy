import { useCallback } from "react";
import { useAppDispatch, useAppSelector } from "@/app/hooks";
import { useAppearanceSettings } from "@/features/settings/hooks/useSettings";
import {
  updateEffectiveSettingsLocal,
  updateSettings,
} from "@/features/settings/store/settingsSlice";
import type { TaskOpenView } from "@/features/projects/utils/taskPath";

export function useTaskViewPreference() {
  const dispatch = useAppDispatch();
  const { taskOpenView } = useAppearanceSettings();
  const saving = useAppSelector((state) => state.settings.saving);
  const profileId = useAppSelector((state) => state.settings.profileId);
  const save = useCallback(
    async (view: TaskOpenView) => {
      const appearance = { taskOpenView: view };
      const result = await dispatch(updateSettings({ appearance }));
      if (updateSettings.fulfilled.match(result)) {
        dispatch(updateEffectiveSettingsLocal({ appearance }));
      }
    },
    [dispatch],
  );
  return { taskOpenView, save, disabled: saving || !profileId };
}
