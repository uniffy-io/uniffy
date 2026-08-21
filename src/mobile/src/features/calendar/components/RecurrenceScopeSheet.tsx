import React from "react";
import { View, StyleSheet } from "react-native";
import { ArrowsClockwise, CalendarBlank, FastForward } from "phosphor-react-native";
import { RecurrenceEditScope } from "@uniffy/proto/cal/v1/calendar_pb";
import { BottomSheet } from "@shared/components/BottomSheet";
import { SheetHeader } from "@shared/components/SheetHeader";
import { SheetRow } from "@shared/components/SheetRow";
import { useTheme } from "@shared/hooks/useTheme";

type ScopeOption = {
  value: RecurrenceEditScope;
  icon: React.ComponentType<{ size: number; color: string; weight: "duotone" }>;
  label: string;
  edit: string;
  delete: string;
};

// Wording, order and icons mirror the web dialog
// (features/calendar/components/modals/RecurrenceEditScopeDialog.tsx) so the
// same decision reads the same on both clients.
const OPTIONS: ScopeOption[] = [
  {
    value: RecurrenceEditScope.THIS_EVENT,
    icon: CalendarBlank,
    label: "This event",
    edit: "Only modify this occurrence",
    delete: "Only cancel this occurrence",
  },
  {
    value: RecurrenceEditScope.ALL_EVENTS,
    icon: ArrowsClockwise,
    label: "All events",
    edit: "Modify the entire series",
    delete: "Delete the entire series",
  },
  {
    value: RecurrenceEditScope.THIS_AND_FOLLOWING,
    icon: FastForward,
    label: "This and following events",
    edit: "Modify from this occurrence onwards",
    delete: "Cancel from this occurrence onwards",
  },
];

/**
 * Asks which occurrences a change to a recurring event should reach. Choosing
 * acts immediately, the way every other picker sheet in the app behaves - the
 * web dialog's separate confirm step exists because a desktop dialog has room
 * for one, not because the choice needs re-confirming.
 */
export function RecurrenceScopeSheet({
  visible,
  onClose,
  onSelect,
  action,
  accentColor,
  busy,
}: {
  visible: boolean;
  onClose: () => void;
  onSelect: (scope: RecurrenceEditScope) => void;
  action: "edit" | "delete";
  accentColor?: string;
  busy?: boolean;
}) {
  const T = useTheme();
  const isDelete = action === "delete";
  const tint = isDelete ? T.red : accentColor || T.accent;

  return (
    <BottomSheet visible={visible} onClose={onClose}>
      <SheetHeader
        title={isDelete ? "Delete recurring event" : "Edit recurring event"}
        busy={busy}
        accentColor={tint}
        actions={[{ label: "Cancel", onPress: onClose, tone: "muted" }]}
      />

      {OPTIONS.map((option) => (
        <SheetRow
          key={option.value}
          title={option.label}
          subtitle={isDelete ? option.delete : option.edit}
          accentColor={tint}
          leading={
            <View style={[styles.icon, { backgroundColor: tint + "18" }]}>
              <option.icon size={16} color={tint} weight="duotone" />
            </View>
          }
          onPress={() => onSelect(option.value)}
        />
      ))}
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  icon: {
    width: 32,
    height: 32,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
});
