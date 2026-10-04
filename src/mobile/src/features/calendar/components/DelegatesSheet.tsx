import React, { useEffect, useState } from "react";
import { Alert, Text, TouchableOpacity, View, StyleSheet, ScrollView } from "react-native";
import { Plus, Trash } from "phosphor-react-native";
import { BottomSheet } from "@shared/components/BottomSheet";
import { SheetHeader } from "@shared/components/SheetHeader";
import { Avatar } from "@shared/components/Avatar";
import { useTheme } from "@shared/hooks/useTheme";
import { SubjectPickerSheet } from "@shared/directory/SubjectPickerSheet";
import { FONT } from "@theme/typography";
import { userFacingError } from "@shared/lib/userFacingError";
import { useAuth } from "@core/providers/AuthContext";
import { DELEGATION_LEVEL_LABELS } from "@features/calendar/calendarList";
import type { DelegationLevel, SerializedDelegation } from "@features/calendar/calendarSerializer";
import { useCalendarPolicy } from "@features/calendar/useCalendar";
import {
  useGrantDelegation,
  useMyDelegations,
  useRevokeDelegation,
} from "@features/calendar/useCalendarDelegation";

const LEVELS: DelegationLevel[] = ["events", "events_and_private"];

/** The grantor names colleagues who may run their personal calendars for them. */
export function DelegatesSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const T = useTheme();
  const { user } = useAuth();
  const { data, refetch: refetchDelegations } = useMyDelegations();
  const { data: policy, refetch: refetchPolicy } = useCalendarPolicy();
  const grant = useGrantDelegation();
  const revoke = useRevokeDelegation();
  const [pickerOpen, setPickerOpen] = useState(false);

  // The sheet stays mounted between openings, so an admin's policy change or a delegate stepping
  // down would otherwise wait for the next screen focus.
  useEffect(() => {
    if (!visible) return;
    void refetchDelegations();
    void refetchPolicy();
  }, [visible, refetchDelegations, refetchPolicy]);
  const canDelegate = policy?.canDelegate ?? true;
  const delegates = data?.grantedByMe ?? [];
  const onError = (error: unknown) =>
    Alert.alert("Could not update delegates", userFacingError(error, "Your change was not saved."));

  const add = (delegateId: string) => {
    setPickerOpen(false);
    if (delegateId === user?.id || delegates.some((d) => d.delegateId === delegateId)) return;
    grant.mutate({ delegateId, level: "events" }, { onError });
  };

  return (
    <>
      <BottomSheet visible={visible && !pickerOpen} onClose={onClose}>
        <SheetHeader title="Calendar delegates" busy={grant.isPending || revoke.isPending} />
        <ScrollView style={{ maxHeight: 460 }} contentContainerStyle={styles.body}>
          <Text style={[styles.lede, { color: T.textDim }]}>
            Delegates book, edit and cancel meetings and answer invitations for you. You stay the
            organizer; they are shown as the arranger.
          </Text>

          {delegates.length === 0 ? (
            <Text style={[styles.empty, { color: T.textDim }]}>Nobody manages your calendar.</Text>
          ) : (
            delegates.map((delegation) => (
              <DelegateRow
                key={delegation.id}
                delegation={delegation}
                canChange={canDelegate}
                onLevel={(level) =>
                  level !== delegation.level &&
                  grant.mutate({ delegateId: delegation.delegateId, level }, { onError })
                }
                onRemove={() =>
                  Alert.alert(
                    "Remove delegate?",
                    `${delegation.delegateName} will immediately lose access to your calendar.`,
                    [
                      { text: "Cancel", style: "cancel" },
                      {
                        text: "Remove",
                        style: "destructive",
                        onPress: () => revoke.mutate(delegation.id, { onError }),
                      },
                    ],
                  )
                }
              />
            ))
          )}

          {canDelegate ? (
            <TouchableOpacity
              style={[styles.addRow, { borderColor: T.border }]}
              onPress={() => setPickerOpen(true)}
              accessibilityRole="button"
              accessibilityLabel="Add a delegate"
            >
              <Plus size={16} color={T.accent} weight="bold" />
              <Text style={[styles.addLabel, { color: T.accent }]}>Add a delegate</Text>
            </TouchableOpacity>
          ) : (
            <Text style={[styles.notice, { color: T.textDim, backgroundColor: T.surface }]}>
              Your organization lets only calendar admins add delegates.
            </Text>
          )}
        </ScrollView>
      </BottomSheet>

      <SubjectPickerSheet
        visible={visible && pickerOpen}
        onClose={() => setPickerOpen(false)}
        title="Add a delegate"
        selectedIds={delegates.map((d) => d.delegateId)}
        onToggle={add}
      />
    </>
  );
}

function DelegateRow({
  delegation,
  canChange,
  onLevel,
  onRemove,
}: {
  delegation: SerializedDelegation;
  canChange: boolean;
  onLevel: (level: DelegationLevel) => void;
  onRemove: () => void;
}) {
  const T = useTheme();
  return (
    <View style={[styles.row, { borderColor: T.border }]}>
      <View style={styles.rowTop}>
        <Avatar name={delegation.delegateName} size={32} />
        <View style={{ flex: 1 }}>
          <Text style={[styles.name, { color: T.textBright }]} numberOfLines={1}>
            {delegation.delegateName}
          </Text>
          {delegation.inactive && (
            <Text style={[styles.meta, { color: T.textDim }]}>
              Deactivated - has no access for now
            </Text>
          )}
        </View>
        <TouchableOpacity
          onPress={onRemove}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          accessibilityRole="button"
          accessibilityLabel={`Remove ${delegation.delegateName}`}
        >
          <Trash size={18} color={T.textDim} />
        </TouchableOpacity>
      </View>
      <View style={styles.levels}>
        {LEVELS.map((level) => {
          const active = delegation.level === level;
          // Under an admins-only policy a member may still lower a level, never raise one.
          const locked = !canChange && level === "events_and_private";
          return (
            <TouchableOpacity
              key={level}
              disabled={locked}
              onPress={() => onLevel(level)}
              style={[
                styles.level,
                {
                  borderColor: active ? T.accent : T.border,
                  backgroundColor: active ? T.accent + "18" : "transparent",
                },
              ]}
              accessibilityRole="radio"
              accessibilityState={{ checked: active, disabled: locked }}
            >
              <Text
                style={[
                  styles.levelLabel,
                  { color: active ? T.accent : T.textDim, opacity: locked ? 0.5 : 1 },
                ]}
              >
                {DELEGATION_LEVEL_LABELS[level]}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  body: { paddingHorizontal: 16, paddingBottom: 16, gap: 10 },
  lede: { fontSize: 13, fontFamily: FONT.regular, lineHeight: 18 },
  empty: { fontSize: 14, fontFamily: FONT.regular, paddingVertical: 8 },
  notice: { fontSize: 13, fontFamily: FONT.regular, padding: 10, borderRadius: 8 },
  row: { borderWidth: 1, borderRadius: 10, padding: 10, gap: 8 },
  rowTop: { flexDirection: "row", alignItems: "center", gap: 10 },
  name: { fontSize: 15, fontFamily: FONT.medium },
  meta: { fontSize: 12, fontFamily: FONT.regular },
  levels: { flexDirection: "row", gap: 8 },
  level: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 8,
    alignItems: "center",
    minHeight: 44,
    justifyContent: "center",
  },
  levelLabel: { fontSize: 13, fontFamily: FONT.medium, textAlign: "center" },
  addRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderWidth: 1,
    borderStyle: "dashed",
    borderRadius: 10,
    padding: 12,
    minHeight: 44,
  },
  addLabel: { fontSize: 14, fontFamily: FONT.medium },
});
