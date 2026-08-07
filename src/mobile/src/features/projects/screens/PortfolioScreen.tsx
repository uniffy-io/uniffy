import React, { useMemo } from "react";
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  Platform,
  ActivityIndicator,
  RefreshControl,
} from "react-native";
import { CaretRight, WarningCircle } from "phosphor-react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router } from "expo-router";
import { DomainHeader } from "@shared/components/DomainHeader";
import { useTheme } from "@shared/hooks/useTheme";
import { BOTTOM_NAV_HEIGHT } from "@theme/theme";
import { FONT } from "@theme/typography";
import { useProjectsList } from "@features/projects/useProjects";
import {
  projectStats,
  projectHealth,
  PROJECT_HEALTH_LABELS,
} from "@features/projects/projectsSerializer";
import { formatMinutes } from "@features/projects/timeFormatting";
import type { ProjectHealth, SerializedProject } from "@features/projects/projectsSerializer";

function healthColor(health: ProjectHealth, T: ReturnType<typeof useTheme>): string {
  if (health === "behind") return T.red;
  if (health === "at_risk") return T.yellow;
  if (health === "on_track") return T.green;
  return T.textDim;
}

export function PortfolioScreen() {
  const T = useTheme();
  const insets = useSafeAreaInsets();
  const projectsQuery = useProjectsList();
  const projects = useMemo(() => projectsQuery.data ?? [], [projectsQuery.data]);

  const bottomPad =
    Platform.OS === "web" ? BOTTOM_NAV_HEIGHT + 34 : BOTTOM_NAV_HEIGHT + insets.bottom;

  const totals = useMemo(() => {
    return projects.reduce(
      (acc, p) => ({
        tasks: acc.tasks + p.taskCount,
        done: acc.done + p.completedTaskCount,
        overdue: acc.overdue + p.overdueTaskCount,
        estimated: acc.estimated + p.estimatedMinutes,
        spent: acc.spent + p.timeSpentMinutes,
      }),
      { tasks: 0, done: 0, overdue: 0, estimated: 0, spent: 0 },
    );
  }, [projects]);

  // Worst health first so the projects that need attention are at the top.
  const ordered = useMemo(() => {
    const rank: Record<ProjectHealth, number> = {
      behind: 0,
      at_risk: 1,
      on_track: 2,
      not_started: 3,
    };
    return [...projects].sort(
      (a, b) => rank[projectHealth(a)] - rank[projectHealth(b)] || a.name.localeCompare(b.name),
    );
  }, [projects]);

  const overallProgress = totals.tasks === 0 ? 0 : Math.round((totals.done / totals.tasks) * 100);

  return (
    <View style={[styles.container, { backgroundColor: T.pageBg }]}>
      <DomainHeader title="Portfolio" subtitle="All projects" color={T.accent} icon="projects" />

      {projectsQuery.isLoading && !projectsQuery.data ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={T.accent} />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: bottomPad }}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={projectsQuery.isFetching && !projectsQuery.isLoading}
              onRefresh={() => projectsQuery.refetch()}
              tintColor={T.accent}
              colors={[T.accent]}
            />
          }
        >
          <View style={[styles.summary, { backgroundColor: T.surface, borderColor: T.border }]}>
            <View style={styles.summaryTop}>
              <Text style={[styles.summaryPct, { color: T.textBright }]}>{overallProgress}%</Text>
              <Text style={[styles.summaryCaption, { color: T.textDim }]}>
                {totals.done} of {totals.tasks} tasks across {projects.length} project
                {projects.length === 1 ? "" : "s"}
              </Text>
            </View>
            <View style={[styles.progressTrack, { backgroundColor: T.surfaceHover }]}>
              <View
                style={[
                  styles.progressFill,
                  { width: `${overallProgress}%` as any, backgroundColor: T.accent },
                ]}
              />
            </View>
            <View style={styles.statRow}>
              <View style={styles.stat}>
                <Text
                  style={[styles.statValue, { color: totals.overdue > 0 ? T.red : T.textBright }]}
                >
                  {totals.overdue}
                </Text>
                <Text style={[styles.statLabel, { color: T.textDim }]}>Overdue</Text>
              </View>
              <View style={styles.stat}>
                <Text style={[styles.statValue, { color: T.textBright }]}>
                  {totals.estimated > 0 ? formatMinutes(totals.estimated) : "-"}
                </Text>
                <Text style={[styles.statLabel, { color: T.textDim }]}>Estimated</Text>
              </View>
              <View style={styles.stat}>
                <Text
                  style={[
                    styles.statValue,
                    {
                      color:
                        totals.estimated > 0 && totals.spent > totals.estimated
                          ? T.red
                          : T.textBright,
                    },
                  ]}
                >
                  {totals.spent > 0 ? formatMinutes(totals.spent) : "-"}
                </Text>
                <Text style={[styles.statLabel, { color: T.textDim }]}>Spent</Text>
              </View>
            </View>
          </View>

          {ordered.map((project) => (
            <PortfolioRow key={project.id} project={project} />
          ))}

          {projects.length === 0 && (
            <Text style={[styles.empty, { color: T.textDim }]}>No projects yet</Text>
          )}
        </ScrollView>
      )}
    </View>
  );
}

function PortfolioRow({ project }: { project: SerializedProject }) {
  const T = useTheme();
  const stats = projectStats(project);
  const health = projectHealth(project);
  const color = healthColor(health, T);
  const projectColor = project.color || T.accent;
  const overBudget =
    project.estimatedMinutes > 0 && project.timeSpentMinutes > project.estimatedMinutes;

  return (
    <TouchableOpacity
      style={[styles.row, { backgroundColor: T.surface, borderColor: T.border }]}
      onPress={() => router.push(`/projects/${project.id}` as any)}
      activeOpacity={0.8}
    >
      <View style={styles.rowTop}>
        <Text style={[styles.rowName, { color: T.textBright }]} numberOfLines={1}>
          {project.name}
        </Text>
        <View style={[styles.healthBadge, { backgroundColor: color + "1e" }]}>
          <Text style={[styles.healthText, { color }]}>{PROJECT_HEALTH_LABELS[health]}</Text>
        </View>
        <CaretRight size={15} color={T.textDim} weight="bold" />
      </View>

      <View style={[styles.progressTrack, { backgroundColor: T.surfaceHover }]}>
        <View
          style={[
            styles.progressFill,
            { width: `${stats.progress}%` as any, backgroundColor: projectColor },
          ]}
        />
      </View>

      <View style={styles.rowMeta}>
        <Text style={[styles.rowMetaText, { color: T.textDim }]}>
          {stats.done}/{stats.total} tasks
        </Text>
        {project.overdueTaskCount > 0 && (
          <View style={styles.overdueChip}>
            <WarningCircle size={12} color={T.red} weight="fill" />
            <Text style={[styles.rowMetaText, { color: T.red }]}>
              {project.overdueTaskCount} overdue
            </Text>
          </View>
        )}
        {project.estimatedMinutes > 0 && (
          <Text style={[styles.rowMetaText, { color: overBudget ? T.red : T.textDim }]}>
            {formatMinutes(project.timeSpentMinutes)} / {formatMinutes(project.estimatedMinutes)}
          </Text>
        )}
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  centered: { flex: 1, alignItems: "center", justifyContent: "center" },
  summary: {
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 16,
    gap: 12,
  },
  summaryTop: { flexDirection: "row", alignItems: "baseline", gap: 10 },
  summaryPct: { fontSize: 30, fontFamily: FONT.bold },
  summaryCaption: { flex: 1, fontSize: 12, fontFamily: FONT.regular, lineHeight: 17 },
  statRow: { flexDirection: "row", justifyContent: "space-between" },
  stat: { flex: 1, alignItems: "center", gap: 2 },
  statValue: { fontSize: 16, fontFamily: FONT.semibold },
  statLabel: { fontSize: 11, fontFamily: FONT.regular },
  progressTrack: { height: 6, borderRadius: 3, overflow: "hidden" },
  progressFill: { height: 6, borderRadius: 3 },
  row: {
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 14,
    gap: 10,
  },
  rowTop: { flexDirection: "row", alignItems: "center", gap: 8 },
  rowName: { flex: 1, fontSize: 15, fontFamily: FONT.semibold },
  healthBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 7 },
  healthText: { fontSize: 11, fontFamily: FONT.medium },
  rowMeta: { flexDirection: "row", alignItems: "center", gap: 12, flexWrap: "wrap" },
  rowMetaText: { fontSize: 12, fontFamily: FONT.regular },
  overdueChip: { flexDirection: "row", alignItems: "center", gap: 4 },
  empty: { fontSize: 14, fontFamily: FONT.regular, textAlign: "center", padding: 32 },
});
