import React, { useMemo } from "react";
import { View, Text, ScrollView, StyleSheet, Platform, ActivityIndicator } from "react-native";
import { WarningCircle } from "phosphor-react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useLocalSearchParams } from "expo-router";
import { DomainHeader } from "@shared/components/DomainHeader";
import { Avatar } from "@shared/components/Avatar";
import { useDirectory } from "@shared/directory/useDirectory";
import { useTheme } from "@shared/hooks/useTheme";
import { BOTTOM_NAV_HEIGHT } from "@theme/theme";
import { FONT } from "@theme/typography";
import { useProject, useProjectTasks } from "@features/projects/useProjects";
import { formatMinutes } from "@features/projects/timeFormatting";
import { buildResourceBuckets, UNASSIGNED } from "@features/projects/resourceBuckets";

export function ResourcesScreen() {
  const { projectId } = useLocalSearchParams<{ projectId: string }>();
  const T = useTheme();
  const insets = useSafeAreaInsets();

  const projectQuery = useProject(projectId);
  const tasksQuery = useProjectTasks(projectId);
  const { byId } = useDirectory();

  const tasks = useMemo(() => tasksQuery.data ?? [], [tasksQuery.data]);
  const buckets = useMemo(() => buildResourceBuckets(tasks), [tasks]);
  const busiest = buckets.reduce((max, b) => Math.max(max, b.open + b.done), 0);

  const project = projectQuery.data;
  const projectColor = project?.color || T.accent;
  const bottomPad =
    Platform.OS === "web" ? BOTTOM_NAV_HEIGHT + 34 : BOTTOM_NAV_HEIGHT + insets.bottom;

  return (
    <View style={[styles.container, { backgroundColor: T.pageBg }]}>
      <DomainHeader
        title="Resources"
        subtitle={project?.name}
        color={projectColor}
        icon="projects"
      />

      {tasksQuery.isLoading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={T.accent} />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: bottomPad }}
          showsVerticalScrollIndicator={false}
        >
          {buckets.map((bucket) => {
            const isUnassigned = bucket.subjectId === UNASSIGNED;
            const subject = isUnassigned ? undefined : byId.get(bucket.subjectId);
            const name = isUnassigned ? "Unassigned" : (subject?.name ?? "Unknown");
            const total = bucket.open + bucket.done;
            const share = busiest === 0 ? 0 : Math.round((total / busiest) * 100);
            const overBudget = bucket.estimated > 0 && bucket.spent > bucket.estimated;

            return (
              <View
                key={bucket.subjectId}
                style={[styles.card, { backgroundColor: T.surface, borderColor: T.border }]}
              >
                <View style={styles.cardTop}>
                  {isUnassigned ? (
                    <View style={[styles.unassignedAvatar, { backgroundColor: T.surfaceHover }]} />
                  ) : (
                    <Avatar name={name} avatarUrl={subject?.avatarUrl} size={32} />
                  )}
                  <View style={{ flex: 1 }}>
                    <Text
                      style={[styles.name, { color: isUnassigned ? T.textDim : T.textBright }]}
                      numberOfLines={1}
                    >
                      {name}
                    </Text>
                    <Text style={[styles.sub, { color: T.textDim }]}>
                      {bucket.open} open - {bucket.done} done
                    </Text>
                  </View>
                  {bucket.overdue > 0 && (
                    <View style={styles.overdueChip}>
                      <WarningCircle size={13} color={T.red} weight="fill" />
                      <Text style={[styles.overdueText, { color: T.red }]}>{bucket.overdue}</Text>
                    </View>
                  )}
                </View>

                <View style={[styles.track, { backgroundColor: T.surfaceHover }]}>
                  <View
                    style={[
                      styles.fill,
                      { width: `${share}%` as any, backgroundColor: projectColor },
                    ]}
                  />
                </View>

                {(bucket.estimated > 0 || bucket.spent > 0) && (
                  <Text style={[styles.time, { color: overBudget ? T.red : T.textDim }]}>
                    {formatMinutes(bucket.spent)} spent
                    {bucket.estimated > 0 ? ` of ${formatMinutes(bucket.estimated)}` : ""}
                  </Text>
                )}
              </View>
            );
          })}

          {buckets.length === 0 && (
            <Text style={[styles.empty, { color: T.textDim }]}>No tasks in this project yet</Text>
          )}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  centered: { flex: 1, alignItems: "center", justifyContent: "center" },
  card: {
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 14,
    gap: 10,
  },
  cardTop: { flexDirection: "row", alignItems: "center", gap: 10 },
  unassignedAvatar: { width: 32, height: 32, borderRadius: 16 },
  name: { fontSize: 15, fontFamily: FONT.medium },
  sub: { fontSize: 12, fontFamily: FONT.regular, marginTop: 2 },
  overdueChip: { flexDirection: "row", alignItems: "center", gap: 4 },
  overdueText: { fontSize: 12, fontFamily: FONT.semibold },
  track: { height: 6, borderRadius: 3, overflow: "hidden" },
  fill: { height: 6, borderRadius: 3 },
  time: { fontSize: 12, fontFamily: FONT.regular },
  empty: { fontSize: 14, fontFamily: FONT.regular, textAlign: "center", padding: 32 },
});
