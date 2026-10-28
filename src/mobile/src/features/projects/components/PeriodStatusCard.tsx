import React, { useRef, useState } from "react";
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { PaperPlaneTilt } from "phosphor-react-native";
import { Avatar } from "@shared/components/Avatar";
import { BottomSheet } from "@shared/components/BottomSheet";
import { SheetHeader } from "@shared/components/SheetHeader";
import { SheetRow } from "@shared/components/SheetRow";
import { useDirectory } from "@shared/directory/useDirectory";
import { useTheme } from "@shared/hooks/useTheme";
import { confirmDestructive } from "@shared/lib/confirmDestructive";
import { FONT } from "@theme/typography";
import { SheetStatusChip } from "@features/projects/components/SheetStatusChip";
import { formatMinutes } from "@features/projects/timeFormatting";
import type { SerializedTimesheet } from "@features/projects/timeSerializer";
import {
  canRecall,
  canSubmit,
  periodLabel,
  sheetSummary,
} from "@features/projects/timesheetStatus";

// The keyboard lifts the sheet over a few frames; scrolling before it settles lands short.
const KEYBOARD_SETTLE_MS = 250;

/** Sends the period to one reviewer, picked when the person has several. */
function SubmitTimesheetSheet({
  visible,
  sheet,
  busy,
  onClose,
  onSubmit,
}: {
  visible: boolean;
  sheet: SerializedTimesheet;
  busy: boolean;
  onClose: () => void;
  onSubmit: (comment: string, reviewerUserId?: string) => void;
}) {
  const T = useTheme();
  const { byId } = useDirectory();
  const scroll = useRef<ScrollView>(null);
  const reviewerIds = sheet.reviewerUserIds;
  const [reviewerId, setReviewerId] = useState(reviewerIds[0] ?? "");
  const [comment, setComment] = useState("");

  const [open, setOpen] = useState(false);
  if (visible && !open) {
    setOpen(true);
    setReviewerId(reviewerIds[0] ?? "");
    setComment("");
  }
  if (!visible && open) setOpen(false);

  const nameOf = (id: string) => byId.get(id)?.name ?? "Reviewer";

  return (
    <BottomSheet visible={visible} onClose={onClose}>
      <SheetHeader
        title="Submit timesheet"
        actions={[
          {
            label: busy ? "Sending" : "Submit",
            onPress: () => onSubmit(comment.trim(), reviewerId || undefined),
            disabled: busy,
          },
        ]}
      />
      <ScrollView
        ref={scroll}
        style={styles.scroll}
        contentContainerStyle={styles.sheetBody}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={[styles.sheetLead, { color: T.textDim }]}>
          Send {periodLabel(sheet)} for review. {formatMinutes(sheet.totalMinutes)} of{" "}
          {formatMinutes(sheet.requiredMinutes)} logged.
        </Text>

        <Text style={[styles.label, { color: T.textDim }]}>Reviewer</Text>
        {reviewerIds.length === 0 ? (
          <Text style={[styles.sheetLead, { color: T.textDim }]}>
            Nobody is named as your reviewer, so the organization admins review it.
          </Text>
        ) : (
          <View style={[styles.reviewers, { borderColor: T.border }]}>
            {reviewerIds.map((id) => {
              const subject = byId.get(id);
              return (
                <SheetRow
                  key={id}
                  leading={
                    <Avatar name={nameOf(id)} avatarUrl={subject?.avatarUrl} size={28} circle />
                  }
                  title={nameOf(id)}
                  selected={reviewerIds.length > 1 && id === reviewerId}
                  onPress={() => setReviewerId(id)}
                />
              );
            })}
          </View>
        )}
        {reviewerIds.length > 1 && (
          <Text style={[styles.hint, { color: T.textDim }]}>
            Only the reviewer you pick is notified. Your other reviewers can still see it.
          </Text>
        )}

        <Text style={[styles.label, { color: T.textDim }]}>Note for your reviewer (optional)</Text>
        <TextInput
          style={[
            styles.input,
            { backgroundColor: T.pageBg, borderColor: T.border, color: T.textBright },
          ]}
          value={comment}
          onChangeText={setComment}
          onFocus={() =>
            setTimeout(() => scroll.current?.scrollToEnd({ animated: true }), KEYBOARD_SETTLE_MS)
          }
          placeholder="Anything they should know"
          placeholderTextColor={T.textDim}
          multiline
          testID="submit-note"
        />
      </ScrollView>
    </BottomSheet>
  );
}

/** The period's state, what was logged against what it asks, and Submit or Recall. */
export function PeriodStatusCard({
  sheet,
  busy,
  onSubmit,
  onRecall,
}: {
  sheet: SerializedTimesheet;
  busy: boolean;
  onSubmit: (comment: string, reviewerUserId?: string) => void;
  onRecall: () => void;
}) {
  const T = useTheme();
  const { byId } = useDirectory();
  const [submitOpen, setSubmitOpen] = useState(false);
  const sentTo = sheet.submittedToUserId ? byId.get(sheet.submittedToUserId)?.name : undefined;
  const { label, tone, detail } = sheetSummary(sheet, sentTo);

  const recall = () =>
    confirmDestructive({
      title: "Recall timesheet",
      message: `Take ${periodLabel(sheet)} back from review so you can change it?`,
      confirmLabel: "Recall",
      onConfirm: onRecall,
    });

  return (
    <View
      style={[styles.card, { backgroundColor: T.surface, borderColor: T.border }]}
      testID="period-status"
    >
      <View style={styles.head}>
        <SheetStatusChip
          label={label}
          tone={tone}
          status={sheet.status}
          locked={sheet.locked}
          periodClosed={sheet.periodClosed}
          testID="period-status-chip"
        />
        <Text style={[styles.period, { color: T.textDim }]}>{periodLabel(sheet)}</Text>
        <View style={{ flex: 1 }} />
        {busy ? (
          <ActivityIndicator size="small" color={T.accent} />
        ) : canSubmit(sheet) ? (
          <TouchableOpacity
            style={[styles.action, { backgroundColor: T.accent }]}
            onPress={() => setSubmitOpen(true)}
            testID="period-submit"
          >
            <PaperPlaneTilt size={13} color="#fff" weight="bold" />
            <Text style={[styles.actionText, { color: "#fff" }]}>
              {sheet.status === "rejected" ? "Submit again" : "Submit"}
            </Text>
          </TouchableOpacity>
        ) : canRecall(sheet) ? (
          <TouchableOpacity
            style={[styles.action, { borderColor: T.border, borderWidth: 1 }]}
            onPress={recall}
            testID="period-recall"
          >
            <Text style={[styles.actionText, { color: T.text }]}>Recall</Text>
          </TouchableOpacity>
        ) : null}
      </View>
      <Text style={[styles.detail, { color: T.textDim }]} testID="period-status-detail">
        {detail}
      </Text>

      <SubmitTimesheetSheet
        visible={submitOpen}
        sheet={sheet}
        busy={busy}
        onClose={() => setSubmitOpen(false)}
        onSubmit={(comment, reviewerUserId) => {
          setSubmitOpen(false);
          onSubmit(comment, reviewerUserId);
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 14, borderWidth: StyleSheet.hairlineWidth, padding: 14, gap: 8 },
  head: { flexDirection: "row", alignItems: "center", gap: 8 },
  period: { fontSize: 12, fontFamily: FONT.regular },
  action: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  actionText: { fontSize: 13, fontFamily: FONT.semibold },
  detail: { fontSize: 13, fontFamily: FONT.regular, lineHeight: 18 },
  scroll: { flexShrink: 1 },
  sheetBody: { paddingHorizontal: 16, paddingBottom: 16, gap: 8 },
  sheetLead: { fontSize: 13, fontFamily: FONT.regular, lineHeight: 18 },
  label: { fontSize: 12, fontFamily: FONT.medium, marginTop: 6 },
  reviewers: { borderRadius: 10, borderWidth: StyleSheet.hairlineWidth, overflow: "hidden" },
  hint: { fontSize: 12, fontFamily: FONT.regular },
  input: {
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    fontFamily: FONT.regular,
    minHeight: 72,
    textAlignVertical: "top",
  },
});
