import React, { useState, useCallback, useMemo } from "react";
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  Platform,
  RefreshControl,
  ActivityIndicator,
  Alert,
} from "react-native";
import * as Clipboard from "expo-clipboard";
import {
  Plus,
  DotsThree,
  Kanban,
  CheckCircle,
  Buildings,
  Lock,
  ChartBar,
} from "phosphor-react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router } from "expo-router";
import { DomainHeader } from "@shared/components/DomainHeader";
import { ActionSheet } from "@shared/components/ActionSheet";
import { confirmDestructive } from "@shared/lib/confirmDestructive";
import { bucketForContent } from "@shared/permissions/contentRoles";
import type { ContentBucket } from "@shared/permissions/contentRoles";
import { useTheme } from "@shared/hooks/useTheme";
import { useAuth } from "@core/providers/AuthContext";
import { BOTTOM_NAV_HEIGHT } from "@theme/theme";
import { FONT } from "@theme/typography";
import { useIsBookmarked, useToggleBookmark } from "@features/bookmarks/useBookmarks";
import { useProjectsList } from "@features/projects/useProjects";
import { useDeleteProject } from "@features/projects/useProjectMutations";
import type { SerializedProject } from "@features/projects/projectsSerializer";
import { projectStats } from "@features/projects/projectsSerializer";
import { ProjectIcon } from "@features/projects/components/ProjectIcon";

type ProjectScope = "all" | ContentBucket;

// Web narrows to personal/organization only, which leaves a project someone
// shared directly with you reachable from "All" alone. The extra segment keeps
// every project in reach without changing what the shared buckets mean.
const SCOPES: { key: ProjectScope; label: string }[] = [
  { key: "all", label: "All" },
  { key: "personal", label: "Mine" },
  { key: "shared", label: "Shared" },
  { key: "organization", label: "Org" },
];

function projectSheetSubtitle(project: SerializedProject): string {
  const { done, total } = projectStats(project);
  const tasks = `${done}/${total} task${total === 1 ? "" : "s"}`;
  if (project.memberCount === 0) return tasks;
  return `${tasks} - ${project.memberCount} member${project.memberCount === 1 ? "" : "s"}`;
}

const ProjectCard = React.memo(function ProjectCard({
  project,
  onPress,
  onMore,
}: {
  project: SerializedProject;
  onPress: (project: SerializedProject) => void;
  onMore: (project: SerializedProject) => void;
}) {
  const T = useTheme();
  const stats = projectStats(project);
  const projectColor = project.color || T.accent;

  return (
    <TouchableOpacity
      style={[styles.projectCard, { backgroundColor: T.surface, borderColor: T.border }]}
      onPress={() => onPress(project)}
      activeOpacity={0.8}
    >
      <View style={styles.projectTop}>
        <View style={[styles.projectIcon, { backgroundColor: projectColor + "20" }]}>
          <ProjectIcon icon={project.icon} color={projectColor} size={16} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[styles.projectName, { color: T.textBright }]}>{project.name}</Text>
          <View style={styles.metaRow}>
            {project.visibility === "ORGANIZATION" ? (
              <View style={[styles.visibilityBadge, { backgroundColor: T.surfaceHover }]}>
                <Buildings size={10} color={T.textDim} weight="fill" />
                <Text style={[styles.visibilityText, { color: T.textDim }]}>Org</Text>
              </View>
            ) : (
              <View style={[styles.visibilityBadge, { backgroundColor: T.surfaceHover }]}>
                <Lock size={10} color={T.textDim} weight="fill" />
                <Text style={[styles.visibilityText, { color: T.textDim }]}>Private</Text>
              </View>
            )}
            {project.memberCount > 0 && (
              <Text style={[styles.memberCount, { color: T.textDim }]}>
                {project.memberCount} member{project.memberCount !== 1 ? "s" : ""}
              </Text>
            )}
          </View>
        </View>
        <TouchableOpacity
          onPress={() => onMore(project)}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <DotsThree size={20} color={T.textDim} weight="bold" />
        </TouchableOpacity>
      </View>

      {project.description ? (
        <Text style={[styles.descriptionText, { color: T.textDim }]} numberOfLines={2}>
          {project.description}
        </Text>
      ) : null}

      <View style={styles.progressSection}>
        <View style={[styles.progressTrack, { backgroundColor: T.surfaceHover }]}>
          <View
            style={[
              styles.progressFill,
              { width: `${stats.progress}%` as any, backgroundColor: projectColor },
            ]}
          />
        </View>
        <Text style={[styles.progressPct, { color: T.textDim }]}>{stats.progress}%</Text>
      </View>

      <View style={styles.taskStats}>
        <View style={styles.taskStat}>
          <CheckCircle size={11} color={T.green} weight="fill" />
          <Text style={[styles.taskStatNum, { color: T.text }]}>{stats.done} done</Text>
        </View>
        <View style={styles.taskStat}>
          <View style={[styles.dot, { backgroundColor: T.blue }]} />
          <Text style={[styles.taskStatNum, { color: T.text }]}>{stats.inProgress} open</Text>
        </View>
        <Text style={[styles.taskStatNum, { color: T.textDim, marginLeft: "auto" }]}>
          {stats.total} total
        </Text>
      </View>
    </TouchableOpacity>
  );
});

export function ProjectsListScreen() {
  const T = useTheme();
  const insets = useSafeAreaInsets();
  const [sheetProject, setSheetProject] = useState<SerializedProject | null>(null);
  const [scope, setScope] = useState<ProjectScope>("all");

  const { user } = useAuth();
  const projectsQuery = useProjectsList();
  const deleteProject = useDeleteProject();
  const toggleBookmark = useToggleBookmark();
  const sheetIsBookmarked = useIsBookmarked(sheetProject?.urn ?? "").data ?? false;
  const allProjects = useMemo(() => projectsQuery.data ?? [], [projectsQuery.data]);
  const currentUserId = user?.id ?? "";

  const projects = useMemo(() => {
    if (scope === "all") return allProjects;
    return allProjects.filter(
      (p) =>
        bucketForContent({
          ownerId: p.ownerId,
          accessMode: p.accessMode,
          currentUserId,
        }) === scope,
    );
  }, [allProjects, scope, currentUserId]);

  const onRefresh = useCallback(() => {
    projectsQuery.refetch();
  }, [projectsQuery]);

  const openProject = useCallback((project: SerializedProject) => {
    router.push(`/projects/${project.id}` as any);
  }, []);

  const copyReferenceLink = useCallback(async (project: SerializedProject) => {
    await Clipboard.setStringAsync(project.urn);
    Alert.alert("Copied", "Reference link copied to clipboard.");
  }, []);

  // Seeds a new note that opens with the project already @-mentioned, so the
  // note and the project reference each other from the first save.
  const openProjectNote = useCallback((project: SerializedProject) => {
    router.push({
      pathname: "/notes/edit" as any,
      params: {
        initialTitle: `${project.name} notes`,
        initialContent: `[[[${project.name}|${project.urn}]]]\n\n`,
      },
    });
  }, []);

  const renderProject = useCallback(
    ({ item }: { item: SerializedProject }) => (
      <ProjectCard project={item} onPress={openProject} onMore={setSheetProject} />
    ),
    [openProject],
  );

  const bottomPad =
    Platform.OS === "web" ? BOTTOM_NAV_HEIGHT + 34 : BOTTOM_NAV_HEIGHT + insets.bottom;

  return (
    <View style={[styles.container, { backgroundColor: T.pageBg }]}>
      <DomainHeader
        title="Projects"
        color={T.accent}
        icon="projects"
        rightActions={
          <>
            <TouchableOpacity
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              onPress={() => router.push("/projects/portfolio" as any)}
            >
              <ChartBar size={20} color={T.text} weight="duotone" />
            </TouchableOpacity>
            <TouchableOpacity
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              onPress={() => router.push("/projects/create" as any)}
            >
              <Plus size={21} color={T.accent} weight="bold" />
            </TouchableOpacity>
          </>
        }
      />

      <View style={[styles.scopeRow, { backgroundColor: T.bg, borderBottomColor: T.border }]}>
        {SCOPES.map((option) => {
          const isActive = scope === option.key;
          return (
            <TouchableOpacity
              key={option.key}
              style={[
                styles.scopeChip,
                isActive
                  ? { backgroundColor: T.accent }
                  : {
                      backgroundColor: T.surface,
                      borderColor: T.border,
                      borderWidth: StyleSheet.hairlineWidth,
                    },
              ]}
              onPress={() => setScope(option.key)}
              activeOpacity={0.7}
            >
              <Text style={[styles.scopeText, { color: isActive ? "#fff" : T.textDim }]}>
                {option.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {projectsQuery.isLoading && !projectsQuery.data ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={T.accent} />
        </View>
      ) : (
        <FlatList
          data={projects}
          keyExtractor={(item) => item.id}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: bottomPad }}
          refreshControl={
            <RefreshControl
              refreshing={projectsQuery.isFetching && !projectsQuery.isLoading}
              onRefresh={onRefresh}
              tintColor={T.accent}
              colors={[T.accent]}
            />
          }
          ListEmptyComponent={
            allProjects.length > 0 ? (
              <View style={styles.emptyState}>
                <View style={[styles.emptyIconWrap, { backgroundColor: T.accentSoft }]}>
                  <Kanban size={36} color={T.accent} weight="duotone" />
                </View>
                <Text style={[styles.emptyTitle, { color: T.textBright }]}>Nothing here</Text>
                <Text style={[styles.emptySubtitle, { color: T.textDim }]}>
                  No projects in this view. Switch to All to see the rest.
                </Text>
              </View>
            ) : (
              <View style={styles.emptyState}>
                <View style={[styles.emptyIconWrap, { backgroundColor: T.accentSoft }]}>
                  <Kanban size={36} color={T.accent} weight="duotone" />
                </View>
                <Text style={[styles.emptyTitle, { color: T.textBright }]}>No projects yet</Text>
                <Text style={[styles.emptySubtitle, { color: T.textDim }]}>
                  Create your first project to track work
                </Text>
                <TouchableOpacity
                  style={[styles.emptyCta, { backgroundColor: T.accent }]}
                  activeOpacity={0.8}
                  onPress={() => router.push("/projects/create" as any)}
                >
                  <Text style={styles.emptyCtaText}>Create project</Text>
                </TouchableOpacity>
              </View>
            )
          }
          renderItem={renderProject}
        />
      )}

      <ActionSheet
        visible={!!sheetProject}
        onClose={() => setSheetProject(null)}
        title={sheetProject?.name ?? ""}
        subtitle={sheetProject ? projectSheetSubtitle(sheetProject) : ""}
        icon="projects"
        iconColor={sheetProject?.color || T.accent}
        actions={[
          {
            icon: "plus-circle",
            label: "Add task",
            onPress: () => {
              const pid = sheetProject?.id;
              setSheetProject(null);
              if (pid)
                router.push({
                  pathname: "/projects/task/create" as any,
                  params: { projectId: pid },
                });
            },
          },
          {
            icon: "at-sign",
            label: "Copy reference link",
            sublabel: sheetProject?.urn ?? "",
            onPress: () => {
              const target = sheetProject;
              setSheetProject(null);
              if (target) void copyReferenceLink(target);
            },
          },
          {
            icon: "star",
            label: sheetIsBookmarked ? "Remove from favorites" : "Add to favorites",
            onPress: () => {
              const target = sheetProject;
              setSheetProject(null);
              if (target) toggleBookmark.mutate(target.urn);
            },
          },
          {
            icon: "edit-3",
            label: "Create project note",
            color: T.accent,
            onPress: () => {
              const target = sheetProject;
              setSheetProject(null);
              if (target) openProjectNote(target);
            },
          },
          {
            icon: "trash-2",
            label: "Delete project",
            isDanger: true,
            onPress: () => {
              const target = sheetProject;
              setSheetProject(null);
              if (!target) return;
              confirmDestructive({
                title: "Delete project",
                message: `"${target.name}" and its ${target.taskCount} task${target.taskCount === 1 ? "" : "s"} will be moved to the trash.`,
                onConfirm: () => deleteProject.mutate(target.id),
              });
            },
          },
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  loadingContainer: { flex: 1, alignItems: "center", justifyContent: "center" },
  scopeRow: {
    flexDirection: "row",
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  scopeChip: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  scopeText: { fontSize: 13, fontFamily: FONT.medium },
  projectCard: {
    borderRadius: 14,
    padding: 14,
    gap: 12,
    borderWidth: StyleSheet.hairlineWidth,
  },
  projectTop: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  projectIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  projectName: { fontSize: 15, fontFamily: FONT.semibold },
  metaRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 4 },
  visibilityBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  visibilityText: { fontSize: 10, fontFamily: FONT.medium },
  memberCount: { fontSize: 11, fontFamily: FONT.regular },
  descriptionText: { fontSize: 13, fontFamily: FONT.regular, lineHeight: 18 },
  progressSection: { flexDirection: "row", alignItems: "center", gap: 10 },
  progressTrack: { flex: 1, height: 5, borderRadius: 3, overflow: "hidden" },
  progressFill: { height: 5, borderRadius: 3 },
  progressPct: { fontSize: 12, fontFamily: FONT.semibold, width: 36 },
  taskStats: { flexDirection: "row", alignItems: "center", gap: 12 },
  taskStat: { flexDirection: "row", alignItems: "center", gap: 4 },
  taskStatNum: { fontSize: 11, fontFamily: FONT.regular },
  dot: { width: 9, height: 9, borderRadius: 5 },
  emptyState: { alignItems: "center", paddingTop: 60, gap: 12 },
  emptyIconWrap: {
    width: 76,
    height: 76,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 4,
  },
  emptyTitle: { fontSize: 17, fontFamily: FONT.semibold },
  emptySubtitle: { fontSize: 14, fontFamily: FONT.regular, textAlign: "center" },
  emptyCta: { marginTop: 8, paddingHorizontal: 24, paddingVertical: 11, borderRadius: 10 },
  emptyCtaText: { fontSize: 14, fontFamily: FONT.semibold, color: "#fff" },
});
