import { CallActivity } from "@features/calls/components/CallActivity";
import React, { useCallback, useState } from "react";
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
  Platform,
} from "react-native";
import { router, useLocalSearchParams, useFocusEffect } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { DotsThree } from "phosphor-react-native";
import * as Clipboard from "expo-clipboard";
import { getServerUrl } from "@core/config/serverUrl";
import { ActionSheet } from "@shared/components/ActionSheet";
import { Avatar } from "@shared/components/Avatar";
import { DomainHeader } from "@shared/components/DomainHeader";
import { ScreenError } from "@shared/components/ScreenError";
import { useTheme } from "@shared/hooks/useTheme";
import { sanitizeMentionLabel } from "@shared/mentions/mentionLabel";
import { BOTTOM_NAV_HEIGHT } from "@theme/theme";
import { FONT } from "@theme/typography";
import { useCallHistory } from "@features/calls/useCallHistory";
import { callDuration } from "@features/calls/historySerializer";
import { formatCallClock, formatCallStart } from "@features/calls/historyFormat";

const TITLE = "Call summary";

export function CallRecordScreen() {
  const T = useTheme();
  const insets = useSafeAreaInsets();
  const bottomPad =
    Platform.OS === "web" ? BOTTOM_NAV_HEIGHT + 34 : BOTTOM_NAV_HEIGHT + insets.bottom;
  const { id } = useLocalSearchParams<{ id: string }>();
  const history = useCallHistory(undefined, id);
  const { refetch } = history;
  const [sheetOpen, setSheetOpen] = useState(false);
  useFocusEffect(
    useCallback(() => {
      void refetch();
    }, [refetch]),
  );
  const record = history.data?.pages[0]?.records[0];
  const people = history.data?.pages.flatMap((page) => page.people) ?? [];
  const goBack = () => (router.canGoBack() ? router.back() : router.replace("/calls"));

  // A failed refocus refetch keeps the summary already on screen.
  if (history.isError && !record) {
    return (
      <ScreenError
        title={TITLE}
        icon="chat"
        color={T.accent}
        message="This call could not be loaded. You may no longer have access to its conversation."
        onRetry={() => void refetch()}
      />
    );
  }

  if (!record) {
    return (
      <View style={[styles.screen, { backgroundColor: T.pageBg }]}>
        <DomainHeader title={TITLE} icon="chat" color={T.accent} onBack={goBack} />
        <View style={styles.loadingWrap}>
          <ActivityIndicator size="large" color={T.accent} />
        </View>
      </View>
    );
  }

  const copy = async (text: string, what: string) => {
    await Clipboard.setStringAsync(text);
    Alert.alert("Copied", `${what} copied to clipboard.`);
  };

  return (
    <View style={[styles.screen, { backgroundColor: T.pageBg }]}>
      <DomainHeader
        title={TITLE}
        icon="chat"
        color={T.accent}
        onBack={goBack}
        rightActions={
          <TouchableOpacity
            onPress={() => setSheetOpen(true)}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            accessibilityRole="button"
            accessibilityLabel="Call actions"
          >
            <DotsThree size={22} color={T.text} weight="bold" />
          </TouchableOpacity>
        }
      />
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: bottomPad }]}>
        <Text style={[styles.title, { color: T.textBright }]}>{record.title}</Text>
        <Text style={[styles.caption, { color: T.textDim }]}>
          {formatCallStart(record.startedAt)}
        </Text>
        <Text style={[styles.caption, { color: T.text }]}>
          {callDuration(record)} · {record.participantCount} participants
          {record.attended ? " · You joined" : ""}
        </Text>
        {!!record.outcome && (
          <Text style={[styles.caption, { color: T.textDim }]}>{record.outcome} invite</Text>
        )}
        <CallActivity people={people} />
        <Text style={[styles.sectionLabel, { color: T.textDim }]}>PEOPLE</Text>
        <View style={[styles.card, { backgroundColor: T.surface, borderColor: T.border }]}>
          {people.map((person, index) => (
            <View
              key={person.userId}
              style={[
                styles.person,
                index < people.length - 1 && {
                  borderBottomColor: T.border,
                  borderBottomWidth: StyleSheet.hairlineWidth,
                },
              ]}
            >
              <Avatar name={person.name} avatarUrl={person.avatarUrl ?? undefined} size={32} />
              <View style={styles.personText}>
                <Text style={[styles.personName, { color: T.textBright }]} numberOfLines={1}>
                  {person.name}
                </Text>
                <Text style={[styles.personSub, { color: T.textDim }]}>
                  {person.joinedAt
                    ? `Joined at ${formatCallClock(person.joinedAt)}`
                    : person.outcome || "Invited"}
                  {person.joinedAt && person.outcome && person.outcome !== "Answered"
                    ? ` · ${person.outcome} invite`
                    : ""}
                </Text>
              </View>
            </View>
          ))}
        </View>
        {history.hasNextPage && (
          <TouchableOpacity
            accessibilityRole="button"
            activeOpacity={0.7}
            style={styles.more}
            disabled={history.isFetchingNextPage}
            onPress={() => void history.fetchNextPage()}
          >
            {history.isFetchingNextPage ? (
              <ActivityIndicator size="small" color={T.accent} />
            ) : (
              <Text style={[styles.moreLabel, { color: T.accent }]}>Show more people</Text>
            )}
          </TouchableOpacity>
        )}
      </ScrollView>

      <ActionSheet
        visible={sheetOpen}
        onClose={() => setSheetOpen(false)}
        title={record.title}
        subtitle={formatCallStart(record.startedAt)}
        icon="chat"
        iconColor={T.accent}
        actions={[
          {
            icon: "message-square",
            label: "Open conversation",
            onPress: () => router.push(`/chat/${record.channelId}`),
          },
          {
            icon: "link-2",
            label: "Copy link",
            onPress: () => void copy(`${getServerUrl()}/calls/${record.id}`, "Link"),
          },
          {
            icon: "at-sign",
            label: "Copy reference",
            onPress: () =>
              void copy(`[[[${sanitizeMentionLabel(record.title)}|${record.urn}]]]`, "Reference"),
          },
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  loadingWrap: { flex: 1, alignItems: "center", justifyContent: "center" },
  content: { padding: 20 },
  title: { fontFamily: FONT.semibold, fontSize: 22 },
  caption: { fontFamily: FONT.regular, fontSize: 13, marginTop: 8 },
  sectionLabel: {
    fontSize: 11,
    fontFamily: FONT.semibold,
    letterSpacing: 0.8,
    marginTop: 24,
    marginBottom: 8,
  },
  card: { borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, overflow: "hidden" },
  person: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  personText: { flex: 1, minWidth: 0 },
  personName: { fontSize: 14, fontFamily: FONT.medium },
  personSub: { fontSize: 12, fontFamily: FONT.regular, marginTop: 1 },
  more: { minHeight: 44, alignItems: "center", justifyContent: "center", marginTop: 8 },
  moreLabel: { fontSize: 14, fontFamily: FONT.semibold },
});
