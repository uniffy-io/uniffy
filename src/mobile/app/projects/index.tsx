import React, { useState, useCallback } from "react";
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  Platform,
  RefreshControl,
  ActivityIndicator,
} from "react-native";
import {
  Funnel,
  Plus,
  DotsThree,
  Kanban,
  CheckCircle,
  Megaphone,
  Wrench,
  Rocket,
  Lightning,
  Globe,
  ShoppingCart,
  GraduationCap,
  Palette,
  Bug,
  Target,
  Trophy,
  Cube,
  Heart,
  Star,
  Eye,
  Buildings,
  Lock,
} from "phosphor-react-native";
import type { IconProps } from "phosphor-react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router } from "expo-router";
import { DomainHeader } from "@/components/DomainHeader";
import { ActionSheet } from "@/components/ActionSheet";
import { useTheme } from "@/hooks/useTheme";
import { BOTTOM_NAV_HEIGHT } from "@/constants/theme";
import { FONT } from "@/constants/typography";
import { useProjectsList } from "@/hooks/useProjects";
import { useDeleteProject } from "@/hooks/useProjectMutations";
import type { SerializedProject } from "@/lib/projectsSerializer";
import { computeProjectStats } from "@/lib/projectsSerializer";
import { useProjectTasks } from "@/hooks/useProjects";

const ICON_MAP: Record<string, React.ComponentType<IconProps>> = {
  kanban: Kanban,
  megaphone: Megaphone,
  wrench: Wrench,
  rocket: Rocket,
  lightning: Lightning,
  globe: Globe,
  cart: ShoppingCart,
  graduation: GraduationCap,
  palette: Palette,
  bug: Bug,
  target: Target,
  trophy: Trophy,
  cube: Cube,
  heart: Heart,
  star: Star,
};

function ProjectIconComponent({
  icon,
  color,
  size,
}: {
  icon: string;
  color: string;
  size: number;
}) {
  const Icon = ICON_MAP[icon] || Kanban;
  return <Icon size={size} color={color} weight="duotone" />;
}

function ProjectCard({
  project,
  onPress,
  onMore,
}: {
  project: SerializedProject;
  onPress: () => void;
  onMore: () => void;
}) {
  const T = useTheme();
  const tasksQuery = useProjectTasks(project.id);
  const tasks = tasksQuery.data ?? [];
  const stats = computeProjectStats(tasks);
  const projectColor = project.color || T.domains.projects;

  return (
    <TouchableOpacity
      style={[styles.projectCard, { backgroundColor: T.surface, borderColor: T.border }]}
      onPress={onPress}
      activeOpacity={0.8}
    >
      <View style={styles.projectTop}>
        <View style={[styles.projectIcon, { backgroundColor: projectColor + "20" }]}>
          <ProjectIconComponent icon={project.icon} color={projectColor} size={16} />
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
            {project.memberIds.length > 0 && (
              <Text style={[styles.memberCount, { color: T.textDim }]}>
                {project.memberIds.length} member{project.memberIds.length !== 1 ? "s" : ""}
              </Text>
            )}
          </View>
        </View>
        <TouchableOpacity onPress={onMore} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
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
          <CheckCircle size={11} color="#22c55e" weight="fill" />
          <Text style={[styles.taskStatNum, { color: T.text }]}>{stats.done} done</Text>
        </View>
        <View style={styles.taskStat}>
          <View style={[styles.dot, { backgroundColor: "#3b82f6" }]} />
          <Text style={[styles.taskStatNum, { color: T.text }]}>{stats.inProgress} open</Text>
        </View>
        <Text style={[styles.taskStatNum, { color: T.textDim, marginLeft: "auto" }]}>
          {stats.total} total
        </Text>
      </View>
    </TouchableOpacity>
  );
}

export default function ProjectsListScreen() {
  const T = useTheme();
  const insets = useSafeAreaInsets();
  const [sheetProject, setSheetProject] = useState<SerializedProject | null>(null);

  const projectsQuery = useProjectsList();
  const deleteProject = useDeleteProject();
  const projects = projectsQuery.data ?? [];

  const onRefresh = useCallback(() => {
    projectsQuery.refetch();
  }, [projectsQuery]);

  const bottomPad =
    Platform.OS === "web" ? BOTTOM_NAV_HEIGHT + 34 : BOTTOM_NAV_HEIGHT + insets.bottom;

  return (
    <View style={[styles.container, { backgroundColor: T.pageBg }]}>
      <DomainHeader
        title="Projects"
        color={T.domains.projects}
        icon="projects"
        rightActions={
          <>
            <TouchableOpacity hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Funnel size={18} color={T.text} weight="duotone" />
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

      {projectsQuery.isLoading && !projectsQuery.data ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={T.domains.projects} />
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
              tintColor={T.domains.projects}
              colors={[T.domains.projects]}
            />
          }
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <View style={[styles.emptyIconWrap, { backgroundColor: T.domains.projectsSoft }]}>
                <Kanban size={36} color={T.domains.projects} weight="duotone" />
              </View>
              <Text style={[styles.emptyTitle, { color: T.textBright }]}>No projects yet</Text>
              <Text style={[styles.emptySubtitle, { color: T.textDim }]}>
                Create your first project to track work
              </Text>
              <TouchableOpacity
                style={[styles.emptyCta, { backgroundColor: T.domains.projects }]}
                activeOpacity={0.8}
                onPress={() => router.push("/projects/create" as any)}
              >
                <Text style={styles.emptyCtaText}>Create project</Text>
              </TouchableOpacity>
            </View>
          }
          renderItem={({ item }) => (
            <ProjectCard
              project={item}
              onPress={() => router.push(`/projects/${item.id}` as any)}
              onMore={() => setSheetProject(item)}
            />
          )}
        />
      )}

      <ActionSheet
        visible={!!sheetProject}
        onClose={() => setSheetProject(null)}
        title={sheetProject?.name ?? ""}
        subtitle={sheetProject ? `${sheetProject.memberIds.length} members` : ""}
        icon="projects"
        iconColor={sheetProject?.color || T.domains.projects}
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
            sublabel: sheetProject ? `@${sheetProject.name.replace(/ /g, "-")}` : "",
            onPress: () => setSheetProject(null),
          },
          { icon: "star", label: "Add to favorites", onPress: () => setSheetProject(null) },
          {
            icon: "edit-3",
            label: "Create project notes",
            color: T.domains.notes,
            onPress: () => {
              setSheetProject(null);
              router.push("/notes/edit" as any);
            },
          },
          {
            icon: "trash-2",
            label: "Delete project",
            isDanger: true,
            onPress: () => {
              const pid = sheetProject?.id;
              setSheetProject(null);
              if (pid) deleteProject.mutate(pid);
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
