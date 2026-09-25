import React from "react";
import { View, Text, TouchableOpacity, StyleSheet } from "react-native";
import { DotsThree, Folder } from "phosphor-react-native";
import type { ThemeColors } from "@theme/theme";
import { FONT } from "@theme/typography";
import type { TreeNode } from "@features/notes/useNotesTree";
import { NoteGlyph } from "@features/notes/components/NoteGlyph";

/**
 * One line per note or folder, the way the web tree lists them: the web's icon, the title and the
 * last edit. Snippets stay out - a note's first line is often a table or a heading and reads as
 * noise at this size.
 */
export function NoteRow({
  node,
  T,
  onPress,
  onDots,
}: {
  node: TreeNode;
  T: ThemeColors;
  onPress: () => void;
  onDots: () => void;
}) {
  return (
    <TouchableOpacity
      style={[styles.row, { borderBottomColor: T.border }]}
      onPress={onPress}
      activeOpacity={0.7}
    >
      <View style={styles.icon}>
        <NoteGlyph icon={node.icon} isCanvas={node.isCanvas} size={19} color={T.textDim} />
      </View>
      <Text style={[styles.title, { color: T.textBright }]} numberOfLines={1}>
        {node.title || "Untitled"}
      </Text>
      {node.editedAt ? (
        <Text style={[styles.meta, { color: T.textDim }]}>{node.editedAt}</Text>
      ) : null}
      <TouchableOpacity onPress={onDots} hitSlop={{ top: 12, bottom: 12, left: 8, right: 8 }}>
        <DotsThree size={18} color={T.textDim} weight="bold" />
      </TouchableOpacity>
    </TouchableOpacity>
  );
}

export function FolderRow({
  node,
  T,
  highlighted,
  onPress,
  onDots,
}: {
  node: TreeNode;
  T: ThemeColors;
  /** A dragged note hovers over it. */
  highlighted: boolean;
  onPress: () => void;
  onDots: () => void;
}) {
  const childCount = node.children?.length ?? 0;
  return (
    <TouchableOpacity
      style={[
        styles.row,
        { borderBottomColor: T.border },
        highlighted && { backgroundColor: T.accentSoft },
      ]}
      onPress={onPress}
      activeOpacity={0.7}
    >
      <View style={styles.icon}>
        <Folder size={20} color={T.textDim} weight="duotone" />
      </View>
      <Text style={[styles.title, { color: T.textBright }]} numberOfLines={1}>
        {node.title || "Untitled"}
      </Text>
      {childCount > 0 ? (
        <Text style={[styles.meta, { color: T.textDim }]}>
          {childCount} {childCount === 1 ? "item" : "items"}
        </Text>
      ) : null}
      <TouchableOpacity onPress={onDots} hitSlop={{ top: 12, bottom: 12, left: 8, right: 8 }}>
        <DotsThree size={18} color={T.textDim} weight="bold" />
      </TouchableOpacity>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    minHeight: 48,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  icon: { width: 22, alignItems: "center", justifyContent: "center", flexShrink: 0 },
  title: { flex: 1, fontSize: 15, fontFamily: FONT.medium },
  meta: { fontSize: 12, fontFamily: FONT.regular, flexShrink: 0 },
});
