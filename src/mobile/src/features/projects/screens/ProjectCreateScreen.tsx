import React, { useState, useRef, useEffect } from "react";
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  TextInput,
  StyleSheet,
  Platform,
  ActivityIndicator,
} from "react-native";
import { MentionTextInput } from "@shared/mentions/MentionTextInput";
import {
  Kanban,
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
  Lock,
  Buildings,
} from "phosphor-react-native";
import type { IconProps } from "phosphor-react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { DomainHeader } from "@shared/components/DomainHeader";
import { useTheme } from "@shared/hooks/useTheme";
import { BOTTOM_NAV_HEIGHT, CATEGORY_COLORS } from "@theme/theme";
import { FONT } from "@theme/typography";
import { useProject } from "@features/projects/useProjects";
import { useCreateProject, useUpdateProject } from "@features/projects/useProjectMutations";

const ICON_OPTIONS: { name: string; Component: React.ComponentType<IconProps> }[] = [
  { name: "kanban", Component: Kanban },
  { name: "rocket", Component: Rocket },
  { name: "megaphone", Component: Megaphone },
  { name: "wrench", Component: Wrench },
  { name: "lightning", Component: Lightning },
  { name: "globe", Component: Globe },
  { name: "target", Component: Target },
  { name: "bug", Component: Bug },
  { name: "palette", Component: Palette },
  { name: "star", Component: Star },
  { name: "trophy", Component: Trophy },
  { name: "cube", Component: Cube },
  { name: "heart", Component: Heart },
  { name: "cart", Component: ShoppingCart },
  { name: "graduation", Component: GraduationCap },
];

export function CreateProjectScreen() {
  const T = useTheme();
  const insets = useSafeAreaInsets();
  const bottomPad =
    Platform.OS === "web" ? BOTTOM_NAV_HEIGHT + 34 : BOTTOM_NAV_HEIGHT + insets.bottom;
  const { projectId } = useLocalSearchParams<{ projectId?: string }>();
  const isEditing = !!projectId;
  const projectQuery = useProject(projectId);
  const createProject = useCreateProject();
  const updateProject = useUpdateProject();

  const [name, setName] = useState("");
  const descriptionRef = useRef("");
  const [initialDescription, setInitialDescription] = useState<string | undefined>(undefined);
  const [selectedIcon, setSelectedIcon] = useState("kanban");
  const [selectedColor, setSelectedColor] = useState(CATEGORY_COLORS[0].hex);
  const [visibility, setVisibility] = useState<"PRIVATE" | "ORGANIZATION">("PRIVATE");

  // Prefill editable fields once the project to edit loads. Adjusting state
  // during render (guarded to run once) avoids an effect that would cascade a
  // second render.
  const project = projectQuery.data;
  const [prefilled, setPrefilled] = useState(false);
  if (project && !prefilled) {
    setPrefilled(true);
    setName(project.name);
    setInitialDescription(project.description || undefined);
    if (project.icon) setSelectedIcon(project.icon);
    if (project.color) setSelectedColor(project.color);
    setVisibility(project.visibility);
  }

  // The description is an uncontrolled ref; seed it once off the render path so
  // an unedited save keeps the loaded text.
  const descSeededRef = useRef(false);
  useEffect(() => {
    if (project && !descSeededRef.current) {
      descSeededRef.current = true;
      descriptionRef.current = project.description ?? "";
    }
  }, [project]);

  const isSaving = createProject.isPending || updateProject.isPending;
  const canSave = name.trim().length > 0 && !isSaving;

  function handleSave() {
    if (!canSave) return;
    if (isEditing && projectId) {
      updateProject.mutate(
        {
          projectId,
          name: name.trim(),
          description: descriptionRef.current.trim(),
          icon: selectedIcon,
          color: selectedColor,
          visibility,
        },
        { onSuccess: () => router.back() },
      );
    } else {
      createProject.mutate(
        {
          name: name.trim(),
          description: descriptionRef.current.trim() || undefined,
          icon: selectedIcon,
          color: selectedColor,
          visibility,
        },
        { onSuccess: () => router.back() },
      );
    }
  }

  return (
    <View style={[styles.container, { backgroundColor: T.pageBg }]}>
      <DomainHeader
        title={isEditing ? "Edit Project" : "New Project"}
        color={T.accent}
        icon="projects"
        rightActions={
          <TouchableOpacity
            onPress={handleSave}
            disabled={!canSave}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            {isSaving ? (
              <ActivityIndicator size="small" color={T.accent} />
            ) : (
              <Text style={[styles.saveBtn, { color: canSave ? T.accent : T.textDim }]}>Save</Text>
            )}
          </TouchableOpacity>
        }
      />

      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: bottomPad }]}
        showsVerticalScrollIndicator={false}
      >
        <View style={{ gap: 6 }}>
          <Text style={[styles.label, { color: T.textDim }]}>Name</Text>
          <TextInput
            style={[
              styles.input,
              { backgroundColor: T.surface, borderColor: T.border, color: T.textBright },
            ]}
            value={name}
            onChangeText={setName}
            placeholder="Project name"
            placeholderTextColor={T.textDim}
            autoFocus={!isEditing}
          />
        </View>

        <View style={{ gap: 6 }}>
          <Text style={[styles.label, { color: T.textDim }]}>Description</Text>
          <MentionTextInput
            style={[
              styles.input,
              styles.textArea,
              { backgroundColor: T.surface, borderColor: T.border, color: T.textBright },
            ]}
            initialContent={initialDescription}
            onCanonicalChange={(c) => {
              descriptionRef.current = c;
            }}
            placeholder="Optional description"
            placeholderTextColor={T.textDim}
            numberOfLines={3}
          />
        </View>

        <View style={{ gap: 8 }}>
          <Text style={[styles.label, { color: T.textDim }]}>Icon</Text>
          <View style={styles.iconGrid}>
            {ICON_OPTIONS.map(({ name: iconName, Component }) => {
              const isActive = selectedIcon === iconName;
              return (
                <TouchableOpacity
                  key={iconName}
                  style={[
                    styles.iconBtn,
                    {
                      backgroundColor: T.surface,
                      borderColor: isActive ? selectedColor : T.border,
                    },
                    isActive && { borderWidth: 2 },
                  ]}
                  onPress={() => setSelectedIcon(iconName)}
                  activeOpacity={0.7}
                >
                  <Component
                    size={18}
                    color={isActive ? selectedColor : T.textDim}
                    weight={isActive ? "duotone" : "duotone"}
                  />
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        <View style={{ gap: 8 }}>
          <Text style={[styles.label, { color: T.textDim }]}>Color</Text>
          <View style={styles.colorRow}>
            {CATEGORY_COLORS.map((c) => {
              const isActive = selectedColor === c.hex;
              return (
                <TouchableOpacity
                  key={c.hex}
                  style={[
                    styles.colorBtn,
                    { backgroundColor: c.hex },
                    isActive && styles.colorBtnActive,
                  ]}
                  onPress={() => setSelectedColor(c.hex)}
                  activeOpacity={0.7}
                />
              );
            })}
          </View>
        </View>

        <View style={{ gap: 8 }}>
          <Text style={[styles.label, { color: T.textDim }]}>Visibility</Text>
          <View style={styles.visibilityRow}>
            <TouchableOpacity
              style={[
                styles.visibilityBtn,
                {
                  backgroundColor: visibility === "PRIVATE" ? T.accent : T.surface,
                  borderColor: visibility === "PRIVATE" ? T.accent : T.border,
                },
              ]}
              onPress={() => setVisibility("PRIVATE")}
              activeOpacity={0.7}
            >
              <Lock size={14} color={visibility === "PRIVATE" ? "#fff" : T.textDim} weight="fill" />
              <Text
                style={[
                  styles.visibilityText,
                  { color: visibility === "PRIVATE" ? "#fff" : T.textDim },
                ]}
              >
                Private
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[
                styles.visibilityBtn,
                {
                  backgroundColor: visibility === "ORGANIZATION" ? T.accent : T.surface,
                  borderColor: visibility === "ORGANIZATION" ? T.accent : T.border,
                },
              ]}
              onPress={() => setVisibility("ORGANIZATION")}
              activeOpacity={0.7}
            >
              <Buildings
                size={14}
                color={visibility === "ORGANIZATION" ? "#fff" : T.textDim}
                weight="fill"
              />
              <Text
                style={[
                  styles.visibilityText,
                  { color: visibility === "ORGANIZATION" ? "#fff" : T.textDim },
                ]}
              >
                Organization
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: 20, gap: 20 },
  label: { fontSize: 12, fontFamily: FONT.semibold, letterSpacing: 0.5 },
  input: {
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    fontFamily: FONT.regular,
  },
  textArea: { minHeight: 80 },
  saveBtn: { fontSize: 15, fontFamily: FONT.semibold },
  iconGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  iconBtn: {
    width: 40,
    height: 40,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: StyleSheet.hairlineWidth,
  },
  colorRow: { flexDirection: "row", gap: 10, flexWrap: "wrap" },
  colorBtn: { width: 32, height: 32, borderRadius: 16 },
  colorBtnActive: {
    borderWidth: 3,
    borderColor: "#fff",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 3,
    elevation: 3,
  },
  visibilityRow: { flexDirection: "row", gap: 10 },
  visibilityBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 11,
    borderRadius: 10,
    borderWidth: 1,
  },
  visibilityText: { fontSize: 14, fontFamily: FONT.medium },
});
