import React, { useMemo, useState } from "react";
import {
  ActivityIndicator,
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { CaretLeft, CaretRight, MagnifyingGlass } from "phosphor-react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuth } from "@core/providers/AuthContext";
import { Avatar } from "@shared/components/Avatar";
import { DomainHeader } from "@shared/components/DomainHeader";
import { useDirectory } from "@shared/directory/useDirectory";
import { useDebouncedValue } from "@shared/hooks/useDebouncedValue";
import { useTheme } from "@shared/hooks/useTheme";
import { BOTTOM_NAV_HEIGHT } from "@theme/theme";
import { FONT } from "@theme/typography";
import { SheetStatusChip } from "@features/projects/components/SheetStatusChip";
import { formatMinutes } from "@features/projects/timeFormatting";
import type { SerializedTimesheetStatus } from "@features/projects/timeSerializer";
import { localDayKey } from "@features/projects/timeSerializer";
import { statusLook } from "@features/projects/timesheetStatus";
import { addDays, formatDayRange } from "@features/projects/timeWeek";
import { useReviewInbox } from "@features/projects/useTimeReview";

const HIT_SLOP = { top: 8, bottom: 8, left: 8, right: 8 };
const SEARCH_DEBOUNCE_MS = 250;

type Filter = "all" | SerializedTimesheetStatus;

const FILTERS: { value: Filter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "submitted", label: "Submitted" },
  { value: "open", label: "Open" },
  { value: "approved", label: "Approved" },
  { value: "rejected", label: "Rejected" },
];

/** Everyone the person reviews for one period, with where each sheet stands. */
export function ApprovalsScreen() {
  const T = useTheme();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const { byId } = useDirectory();
  const params = useLocalSearchParams<{ period?: string }>();
  const today = localDayKey();
  const [day, setDay] = useState(params.period || today);
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const debounced = useDebouncedValue(query, SEARCH_DEBOUNCE_MS);
  const inbox = useReviewInbox(day, {
    status: filter === "all" ? undefined : filter,
    query: debounced,
  });
  const data = inbox.data;
  const isCurrent = data ? data.periodStart <= today && today <= data.periodEnd : true;

  const rows = useMemo(
    () =>
      [...(data?.rows ?? [])].sort((a, b) =>
        (byId.get(a.userId)?.name ?? "").localeCompare(byId.get(b.userId)?.name ?? ""),
      ),
    [data?.rows, byId],
  );
  const waiting = rows.filter((row) => row.status === "submitted").length;

  const bottomPad =
    Platform.OS === "web" ? BOTTOM_NAV_HEIGHT + 34 : BOTTOM_NAV_HEIGHT + insets.bottom;

  return (
    <View style={[styles.container, { backgroundColor: T.pageBg }]}>
      <DomainHeader
        title="Approvals"
        subtitle={data ? formatDayRange(data.periodStart, data.periodEnd) : undefined}
        color={T.accent}
        icon="projects"
        rightActions={
          <>
            <TouchableOpacity
              hitSlop={HIT_SLOP}
              onPress={() => data && setDay(addDays(data.periodStart, -1))}
              accessibilityLabel="Previous period"
              testID="approvals-previous"
            >
              <CaretLeft size={20} color={T.text} weight="bold" />
            </TouchableOpacity>
            <TouchableOpacity
              hitSlop={HIT_SLOP}
              onPress={() => data && setDay(addDays(data.periodEnd, 1))}
              accessibilityLabel="Next period"
              testID="approvals-next"
            >
              <CaretRight size={20} color={T.text} weight="bold" />
            </TouchableOpacity>
          </>
        }
      />

      <ScrollView
        contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: bottomPad }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={inbox.isRefetching && !inbox.isFetchingNextPage}
            onRefresh={() => void inbox.refetch()}
            tintColor={T.accent}
          />
        }
      >
        <View style={styles.summaryRow}>
          <Text style={[styles.summary, { color: T.textBright }]} testID="approvals-waiting">
            {inbox.hasNextPage
              ? `${waiting} waiting in loaded results`
              : waiting > 0
                ? `${waiting} waiting for review`
                : "Nothing waiting"}
            {data?.periodClosed ? <Text style={{ color: T.textDim }}> · closed</Text> : null}
          </Text>
          {!isCurrent && (
            <TouchableOpacity
              onPress={() => setDay(today)}
              hitSlop={HIT_SLOP}
              testID="approvals-today"
            >
              <Text style={[styles.link, { color: T.accent }]}>Today</Text>
            </TouchableOpacity>
          )}
        </View>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.filters}
        >
          {FILTERS.map((option) => {
            const active = option.value === filter;
            return (
              <TouchableOpacity
                key={option.value}
                onPress={() => setFilter(option.value)}
                style={[
                  styles.filter,
                  { borderColor: active ? T.accent : T.border },
                  active && { backgroundColor: T.accentSoft },
                ]}
                accessibilityState={{ selected: active }}
                testID={`approvals-filter-${option.value}`}
              >
                <Text style={[styles.filterText, { color: active ? T.accent : T.text }]}>
                  {option.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>

        <View style={[styles.search, { backgroundColor: T.surface, borderColor: T.border }]}>
          <MagnifyingGlass size={16} color={T.textDim} />
          <TextInput
            style={[styles.searchInput, { color: T.textBright }]}
            value={query}
            onChangeText={setQuery}
            placeholder="Search people"
            placeholderTextColor={T.textDim}
            autoCorrect={false}
            returnKeyType="search"
            testID="approvals-search"
          />
        </View>

        {inbox.isLoading && !data ? (
          <ActivityIndicator style={{ padding: 24 }} color={T.accent} />
        ) : rows.length === 0 ? (
          <Text style={[styles.empty, { color: T.textDim }]}>
            {inbox.isError ? "" : "Nobody matches."}
          </Text>
        ) : (
          <View style={[styles.card, { backgroundColor: T.surface, borderColor: T.border }]}>
            {rows.map((row, index) => {
              const person = byId.get(row.userId);
              const name = person?.name ?? "Member";
              const look = statusLook(
                row.status,
                row.sheet?.locked ?? false,
                row.sheet?.periodClosed ?? false,
              );
              const sentTo = row.status === "submitted" ? row.sheet?.submittedToUserId : null;
              return (
                <TouchableOpacity
                  key={row.userId}
                  style={[
                    styles.row,
                    index > 0 && {
                      borderTopColor: T.border,
                      borderTopWidth: StyleSheet.hairlineWidth,
                    },
                  ]}
                  onPress={() =>
                    router.push(
                      `/projects/review/${row.userId}?day=${data?.periodStart ?? day}` as any,
                    )
                  }
                  accessibilityLabel={`${name}, ${look.label}`}
                  testID="approvals-row"
                >
                  <Avatar name={name} avatarUrl={person?.avatarUrl} size={34} circle />
                  <View style={{ flex: 1, gap: 4 }}>
                    <Text style={[styles.name, { color: T.textBright }]} numberOfLines={1}>
                      {name}
                    </Text>
                    <View style={styles.rowMeta}>
                      <SheetStatusChip
                        small
                        label={look.label}
                        tone={look.tone}
                        status={row.status}
                        locked={row.sheet?.locked}
                        periodClosed={row.sheet?.periodClosed}
                      />
                      {sentTo ? (
                        <Text style={[styles.sentTo, { color: T.textDim }]} numberOfLines={1}>
                          {sentTo === user?.id
                            ? "to you"
                            : `to ${byId.get(sentTo)?.name ?? "another reviewer"}`}
                        </Text>
                      ) : null}
                    </View>
                  </View>
                  <Text style={[styles.minutes, { color: T.textBright }]}>
                    {formatMinutes(row.periodMinutes)}
                    {row.requiredMinutes > 0 && (
                      <Text style={{ color: T.textDim }}>
                        {" "}
                        / {formatMinutes(row.requiredMinutes)}
                      </Text>
                    )}
                  </Text>
                  <CaretRight size={14} color={T.textDim} weight="bold" />
                </TouchableOpacity>
              );
            })}
          </View>
        )}
        {inbox.isError && (
          <Text style={[styles.empty, { color: T.textDim }]}>
            Could not load approvals. Pull down to retry.
          </Text>
        )}
        {inbox.hasNextPage && (
          <TouchableOpacity
            onPress={() => void inbox.fetchNextPage()}
            disabled={inbox.isFetching}
            accessibilityRole="button"
            accessibilityLabel="Load more people"
            testID="approvals-load-more"
          >
            <Text style={[styles.empty, { color: T.accent }]}>
              {inbox.isFetchingNextPage ? "Loading" : "Load more people"}
            </Text>
          </TouchableOpacity>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  summaryRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  summary: { fontSize: 17, fontFamily: FONT.semibold },
  link: { fontSize: 14, fontFamily: FONT.semibold },
  filters: { gap: 8 },
  filter: {
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  filterText: { fontSize: 13, fontFamily: FONT.medium },
  search: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  searchInput: { flex: 1, fontSize: 15, fontFamily: FONT.regular, padding: 0 },
  empty: { fontSize: 14, fontFamily: FONT.regular, textAlign: "center", padding: 24 },
  card: { borderRadius: 14, borderWidth: StyleSheet.hairlineWidth, overflow: "hidden" },
  row: { flexDirection: "row", alignItems: "center", gap: 12, padding: 12 },
  rowMeta: { flexDirection: "row", alignItems: "center", gap: 6 },
  name: { fontSize: 15, fontFamily: FONT.semibold },
  sentTo: { fontSize: 12, fontFamily: FONT.regular, flexShrink: 1 },
  minutes: { fontSize: 13, fontFamily: FONT.semibold },
});
