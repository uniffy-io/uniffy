import React, { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Modal,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { X } from "phosphor-react-native";
import { useTheme } from "@shared/hooks/useTheme";
import { userFacingError } from "@shared/lib/userFacingError";
import { FONT } from "@theme/typography";
import { useTagMutations } from "@features/tags/useTags";
import { TAG_COLORS, type SerializedTag } from "@features/tags/tagSerializer";

interface TagEditorModalProps {
  visible: boolean;
  /** Null creates a tag; a tag edits it. Remount (change the key) to reseed the fields. */
  tag: SerializedTag | null;
  onClose: () => void;
}

export function TagEditorModal({ visible, tag, onClose }: TagEditorModalProps) {
  const T = useTheme();
  const { create, update } = useTagMutations();
  const [name, setName] = useState(tag?.name ?? "");
  const [color, setColor] = useState(tag?.color ?? TAG_COLORS[0]);
  const [description, setDescription] = useState(tag?.description ?? "");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!name.trim()) return;
    setBusy(true);
    try {
      if (tag) {
        await update.mutateAsync({ tagId: tag.id, name: name.trim(), color, description });
      } else {
        await create.mutateAsync({ name: name.trim(), color, description });
      }
      onClose();
    } catch (error) {
      Alert.alert("Could not save tag", userFacingError(error, "The tag was not saved."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.modalBackdrop}>
        <View style={[styles.editorCard, { backgroundColor: T.surface }]}>
          <View style={styles.editorHeader}>
            <Text style={[styles.editorTitle, { color: T.textBright }]}>
              {tag ? "Edit tag" : "New tag"}
            </Text>
            <TouchableOpacity onPress={onClose} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <X size={18} color={T.textDim} weight="bold" />
            </TouchableOpacity>
          </View>

          <TextInput
            value={name}
            onChangeText={setName}
            placeholder="Tag name"
            placeholderTextColor={T.textDim}
            style={[
              styles.editorInput,
              { color: T.textBright, backgroundColor: T.bg, borderColor: T.border },
            ]}
            autoFocus
          />
          <TextInput
            value={description}
            onChangeText={setDescription}
            placeholder="Description (optional)"
            placeholderTextColor={T.textDim}
            style={[
              styles.editorInput,
              { color: T.textBright, backgroundColor: T.bg, borderColor: T.border },
            ]}
          />

          <Text style={[styles.editorLabel, { color: T.textDim }]}>COLOR</Text>
          <View style={styles.colorGrid}>
            {TAG_COLORS.map((c) => (
              <TouchableOpacity
                key={c}
                style={[
                  styles.colorOption,
                  { backgroundColor: c, borderColor: color === c ? T.textBright : "transparent" },
                ]}
                onPress={() => setColor(c)}
                activeOpacity={0.7}
              />
            ))}
          </View>

          <TouchableOpacity
            style={[styles.editorBtn, { backgroundColor: name.trim() ? T.accent : T.surfaceHover }]}
            onPress={submit}
            disabled={!name.trim() || busy}
          >
            {busy ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <Text style={[styles.editorBtnText, { color: name.trim() ? "#fff" : T.textDim }]}>
                {tag ? "Save" : "Create tag"}
              </Text>
            )}
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.6)",
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  editorCard: { width: "100%", borderRadius: 16, padding: 20, gap: 12 },
  editorHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  editorTitle: { fontSize: 16, fontFamily: FONT.bold },
  editorInput: {
    height: 46,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 14,
    fontSize: 15,
    fontFamily: FONT.regular,
  },
  editorLabel: { fontSize: 11, fontFamily: FONT.semibold, letterSpacing: 0.8, marginTop: 4 },
  colorGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  colorOption: { width: 30, height: 30, borderRadius: 15, borderWidth: 2 },
  editorBtn: {
    height: 46,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 6,
  },
  editorBtnText: { fontSize: 15, fontFamily: FONT.semibold },
});
