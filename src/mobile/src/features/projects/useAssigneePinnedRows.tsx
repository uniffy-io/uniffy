import React, { useMemo } from "react";
import { User, UserCircleDashed } from "phosphor-react-native";
import { useAuth } from "@core/providers/AuthContext";
import { useTheme } from "@shared/hooks/useTheme";
import type { PickerPinnedRow } from "@shared/directory/pickerRows";

/** "Assign to me" and, where the list may be cleared, "Unassigned" for an assignee sheet. */
export function useAssigneePinnedRows({
  selectedIds,
  onAssignToMe,
  onUnassign,
}: {
  selectedIds: string[];
  onAssignToMe: (userId: string) => void;
  onUnassign?: () => void;
}): PickerPinnedRow[] {
  const T = useTheme();
  const { user } = useAuth();
  const currentUserId = user?.id;

  return useMemo(() => {
    const rows: PickerPinnedRow[] = [];
    if (currentUserId) {
      rows.push({
        id: "assign-to-me",
        label: "Assign to me",
        leading: <User size={20} color={T.textDim} />,
        selected: selectedIds.includes(currentUserId),
        subjectId: currentUserId,
        onPress: () => onAssignToMe(currentUserId),
      });
    }
    if (onUnassign) {
      rows.push({
        id: "unassigned",
        label: "Unassigned",
        leading: <UserCircleDashed size={20} color={T.textDim} />,
        selected: selectedIds.length === 0,
        onPress: onUnassign,
      });
    }
    return rows;
  }, [currentUserId, selectedIds, onAssignToMe, onUnassign, T.textDim]);
}
