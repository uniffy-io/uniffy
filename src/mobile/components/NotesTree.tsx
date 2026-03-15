import React, { useState, useCallback } from "react";
import { View, Text, TouchableOpacity, StyleSheet } from "react-native";
import {
  CaretRight,
  CaretDown,
  FolderSimple,
  FileText,
  LockSimple,
  UsersThree,
  Buildings,
} from "phosphor-react-native";
import { useTheme } from "@/hooks/useTheme";
import { DOMAIN_COLORS } from "@/constants/theme";
import type { TreeNode, TreeSection } from "@/hooks/useNotesTree";

const SECTION_ICONS: Record<
  string,
  React.ComponentType<{ size: number; color: string; weight: "duotone" | "fill" | "bold" }>
> = {
  personal: LockSimple,
  shared: UsersThree,
  organization: Buildings,
};

function TreeNodeRow({
  node,
  depth,
  onPress,
  onLongPress,
}: {
  node: TreeNode;
  depth: number;
  onPress: (id: string) => void;
  onLongPress: (node: TreeNode) => void;
}) {
  const T = useTheme();
  const [expanded, setExpanded] = useState(false);
  const isFolder = node.type === "folder";
  const hasChildren = isFolder && node.children && node.children.length > 0;
  const indent = 16 + depth * 20;

  const handlePress = useCallback(() => {
    if (isFolder) {
      setExpanded((v) => !v);
    } else {
      onPress(node.id);
    }
  }, [isFolder, node.id, onPress]);

  return (
    <>
      <TouchableOpacity
        style={[styles.nodeRow, { paddingLeft: indent }]}
        onPress={handlePress}
        onLongPress={() => onLongPress(node)}
        activeOpacity={0.7}
      >
        {isFolder ? (
          <View style={styles.nodeChevron}>
            {hasChildren ? (
              expanded ? (
                <CaretDown size={12} color={T.textDim} weight="bold" />
              ) : (
                <CaretRight size={12} color={T.textDim} weight="bold" />
              )
            ) : (
              <View style={{ width: 12 }} />
            )}
          </View>
        ) : (
          <View style={{ width: 18 }} />
        )}

        {isFolder ? (
          <FolderSimple size={16} color={T.textDim} weight="duotone" />
        ) : (
          <FileText size={16} color={DOMAIN_COLORS.notes} weight="duotone" />
        )}

        <Text
          style={[
            styles.nodeTitle,
            { color: isFolder ? T.textBright : T.text },
            isFolder && styles.nodeTitleFolder,
          ]}
          numberOfLines={1}
        >
          {node.title || "Untitled"}
        </Text>
      </TouchableOpacity>

      {isFolder &&
        expanded &&
        node.children?.map((child) => (
          <TreeNodeRow
            key={child.id}
            node={child}
            depth={depth + 1}
            onPress={onPress}
            onLongPress={onLongPress}
          />
        ))}
    </>
  );
}

export function NotesTree({
  sections,
  onNotePress,
  onNoteLongPress,
}: {
  sections: TreeSection[];
  onNotePress: (id: string) => void;
  onNoteLongPress: (node: TreeNode) => void;
}) {
  const T = useTheme();

  return (
    <View style={styles.container}>
      {sections.map((section) => (
        <SectionView
          key={section.id}
          section={section}
          onNotePress={onNotePress}
          onNoteLongPress={onNoteLongPress}
        />
      ))}
    </View>
  );
}

function SectionView({
  section,
  onNotePress,
  onNoteLongPress,
}: {
  section: TreeSection;
  onNotePress: (id: string) => void;
  onNoteLongPress: (node: TreeNode) => void;
}) {
  const T = useTheme();
  const [expanded, setExpanded] = useState(true);
  const SectionIcon = SECTION_ICONS[section.id] || Buildings;

  return (
    <View style={styles.section}>
      <TouchableOpacity
        style={styles.sectionHeader}
        onPress={() => setExpanded((v) => !v)}
        activeOpacity={0.7}
      >
        {expanded ? (
          <CaretDown size={13} color={T.textDim} weight="bold" />
        ) : (
          <CaretRight size={13} color={T.textDim} weight="bold" />
        )}
        <SectionIcon size={16} color={T.textDim} weight="duotone" />
        <Text style={[styles.sectionLabel, { color: T.textBright }]}>{section.label}</Text>
      </TouchableOpacity>

      {expanded && (
        <View>
          {section.nodes.length === 0 ? (
            <Text style={[styles.emptyText, { color: T.textDim }]}>No notes yet</Text>
          ) : (
            section.nodes.map((node) => (
              <TreeNodeRow
                key={node.id}
                node={node}
                depth={0}
                onPress={onNotePress}
                onLongPress={onNoteLongPress}
              />
            ))
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: 8 },
  section: { marginBottom: 4 },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  sectionLabel: {
    fontSize: 14,
    fontFamily: "Inter_600SemiBold",
  },
  emptyText: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    paddingLeft: 44,
    paddingVertical: 6,
  },
  nodeRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 8,
    paddingRight: 16,
  },
  nodeChevron: {
    width: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  nodeTitle: {
    flex: 1,
    fontSize: 14,
    fontFamily: "Inter_400Regular",
  },
  nodeTitleFolder: {
    fontFamily: "Inter_600SemiBold",
  },
});
