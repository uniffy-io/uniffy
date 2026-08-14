import { useEffect } from "react";
import { useAppDispatch, useAppSelector } from "@/app/hooks";
import { ToggleSwitch } from "@/components/ui/toggle-switch";
import { selectMemorySharing } from "@/features/agents/store/agentMemoriesSlice";
import {
  fetchMemorySharing,
  updateMemorySharing,
} from "@/features/agents/store/agentMemoriesThunks";

export function MemorySharingToggle() {
  const dispatch = useAppDispatch();
  const sharing = useAppSelector(selectMemorySharing);

  useEffect(() => {
    if (!sharing.loaded) {
      dispatch(fetchMemorySharing());
    }
  }, [dispatch, sharing.loaded]);

  return (
    <div className="bg-card rounded-lg border border-border p-4 md:p-6">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-sm font-medium text-foreground">
            Use my personal memory in shared spaces
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            {sharing.orgAllows
              ? "When on, agents you trigger in channels and shared sessions can read these memories. Replies others see may draw on them. Agents still never save personal memory from shared spaces."
              : "Disabled by your organization."}
          </p>
        </div>
        <ToggleSwitch
          enabled={sharing.useInSharedSpaces}
          disabled={!sharing.loaded || !sharing.orgAllows}
          onChange={(enabled) => dispatch(updateMemorySharing({ useInSharedSpaces: enabled }))}
        />
      </div>
    </div>
  );
}
