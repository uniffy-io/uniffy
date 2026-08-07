import React, { useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
} from "react-native";
import { FolderPlus, NotePencil } from "phosphor-react-native";
import { router } from "expo-router";
import { AccessMode } from "@uniffy/proto/common/v1/common_pb";
import { NodeType } from "@uniffy/proto/notes/v1/notes_pb";
import { BottomSheet } from "@shared/components/BottomSheet";
import { useTheme } from "@shared/hooks/useTheme";
import { FONT } from "@theme/typography";
import { useCreateNote } from "@features/notes/useNoteMutations";
import { SpacePicker } from "@features/notes/components/SpacePicker";

type CreateNoteSheetProps = {
  visible: boolean;
  onClose: () => void;
  /** Folder the new item lands in. Undefined creates at the root. */
  parentId?: string;
  /** Space the new item joins. Inside a folder this is the folder's own mode,
   * which is why the space picker is hidden there - a child cannot diverge. */
  accessMode: AccessMode;
  /** Hides the space picker when the destination is already fixed. */
  lockSpace?: boolean;
};

export function CreateNoteSheet({
  visible,
  onClose,
  parentId,
  accessMode,
  lockSpace = false,
}: CreateNoteSheetProps) {
  const T = useTheme();
  const createNote = useCreateNote();
  const [space, setSpace] = useState<AccessMode>(accessMode);
  const [folderName, setFolderName] = useState("");
  const [namingFolder, setNamingFolder] = useState(false);

  // The sheet stays mounted between opens; re-seed from the prop on each open
  // so switching the list's space filter is reflected in the picker.
  const [wasVisible, setWasVisible] = useState(visible);
  if (visible !== wasVisible) {
    setWasVisible(visible);
    if (visible) setSpace(accessMode);
  }

  const effectiveMode = lockSpace ? accessMode : space;

  const close = () => {
    setNamingFolder(false);
    setFolderName("");
    onClose();
  };

  const createFolder = () => {
    createNote.mutate(
      {
        title: folderName.trim() || "New Folder",
        content: "",
        parentId,
        accessMode: effectiveMode,
        nodeType: NodeType.FOLDER,
      },
      { onSuccess: close },
    );
  };

  const openEditor = () => {
    const params = new URLSearchParams();
    if (parentId) params.set("parentId", parentId);
    params.set("accessMode", String(effectiveMode));
    close();
    router.push(`/notes/edit?${params.toString()}` as any);
  };

  return (
    <BottomSheet visible={visible} onClose={close}>
      <View style={styles.header}>
        <Text style={[styles.title, { color: T.textBright }]}>Create</Text>
      </View>

      {!lockSpace && (
        <SpacePicker
          value={space === AccessMode.OPEN_TO_ORG ? "organization" : "personal"}
          onSelect={(next) =>
            setSpace(next === "organization" ? AccessMode.OPEN_TO_ORG : AccessMode.OWNER_ONLY)
          }
        />
      )}

      {namingFolder ? (
        <View style={styles.folderForm}>
          <TextInput
            value={folderName}
            onChangeText={setFolderName}
            placeholder="Folder name"
            placeholderTextColor={T.textDim}
            autoFocus
            returnKeyType="done"
            onSubmitEditing={createFolder}
            style={[
              styles.folderInput,
              { color: T.textBright, backgroundColor: T.surface, borderColor: T.border },
            ]}
          />
          <TouchableOpacity
            style={[styles.primaryBtn, { backgroundColor: T.accent }]}
            onPress={createFolder}
            disabled={createNote.isPending}
            activeOpacity={0.8}
          >
            {createNote.isPending ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <Text style={styles.primaryBtnText}>Create folder</Text>
            )}
          </TouchableOpacity>
        </View>
      ) : (
        <View style={styles.options}>
          <OptionRow
            Icon={NotePencil}
            label="New note"
            sublabel="Opens the editor"
            onPress={openEditor}
          />
          <OptionRow
            Icon={FolderPlus}
            label="New folder"
            sublabel="Group notes together"
            onPress={() => setNamingFolder(true)}
          />
        </View>
      )}
    </BottomSheet>
  );
}

function OptionRow({
  Icon,
  label,
  sublabel,
  onPress,
}: {
  Icon: React.ComponentType<{ size: number; color: string; weight: "duotone" }>;
  label: string;
  sublabel: string;
  onPress: () => void;
}) {
  const T = useTheme();
  return (
    <TouchableOpacity style={styles.optionRow} onPress={onPress} activeOpacity={0.7}>
      <View style={[styles.optionIcon, { backgroundColor: T.accentSoft }]}>
        <Icon size={20} color={T.accent} weight="duotone" />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[styles.optionLabel, { color: T.textBright }]}>{label}</Text>
        <Text style={[styles.optionSublabel, { color: T.textDim }]}>{sublabel}</Text>
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  header: { paddingHorizontal: 20, paddingTop: 4, paddingBottom: 12 },
  title: { fontSize: 17, fontFamily: FONT.semibold },
  options: { paddingHorizontal: 12, paddingTop: 6, paddingBottom: 8 },
  optionRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    paddingHorizontal: 8,
    paddingVertical: 12,
  },
  optionIcon: {
    width: 42,
    height: 42,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  optionLabel: { fontSize: 15, fontFamily: FONT.semibold },
  optionSublabel: { fontSize: 12, fontFamily: FONT.regular, marginTop: 2 },
  folderForm: { paddingHorizontal: 20, paddingTop: 8, gap: 12 },
  folderInput: {
    fontSize: 15,
    fontFamily: FONT.regular,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
  },
  primaryBtn: { paddingVertical: 13, borderRadius: 11, alignItems: "center" },
  primaryBtnText: { fontSize: 15, fontFamily: FONT.semibold, color: "#fff" },
});
