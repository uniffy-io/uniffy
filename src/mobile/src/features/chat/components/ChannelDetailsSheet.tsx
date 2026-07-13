import React, { useMemo, useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Modal,
  ScrollView,
  Alert,
} from "react-native";
import {
  Hash,
  Lock,
  Robot,
  ChatCircle,
  PencilSimple,
  Archive,
  Trash,
  SignOut,
  UserPlus,
  X,
  Check,
  FolderSimple,
  BellSlash,
  Bell,
  MagnifyingGlass,
  Gauge,
} from "phosphor-react-native";
import { Avatar } from "@shared/components/Avatar";
import type { ThemeColors } from "@theme/theme";
import { FONT } from "@theme/typography";
import type { ChatMemberSubject } from "@features/chat/useChatMutations";
import { usePresences } from "@shared/presence/usePresence";
import type {
  SerializedChannel,
  SerializedMember,
  SerializedCategory,
  NotificationLevel,
} from "@features/chat/chatSerializer";

const NOTIFICATION_LEVELS: { key: NotificationLevel; label: string }[] = [
  { key: "ALL", label: "All" },
  { key: "MENTIONS", label: "Mentions" },
  { key: "NONE", label: "None" },
];

export type DirectorySubject = {
  id: string;
  name: string;
  email?: string;
  avatarUrl?: string;
  kind?: "USER" | "AGENT";
};

export function ChannelDetailsSheet({
  visible,
  T,
  channel,
  members,
  categories,
  currentUserId,
  directory,
  onClose,
  onRename,
  onSetNotificationLevel,
  onMute,
  onUnmute,
  onAddMembers,
  onRemoveMember,
  onMoveToCategory,
  onArchive,
  onDelete,
  onLeave,
  onShowAgentContext,
}: {
  visible: boolean;
  T: ThemeColors;
  channel: SerializedChannel;
  members: SerializedMember[];
  categories: SerializedCategory[];
  currentUserId: string;
  directory: DirectorySubject[];
  onClose: () => void;
  onRename: (name: string) => void;
  onSetNotificationLevel: (level: NotificationLevel) => void;
  onMute: (untilSeconds: number | null) => void;
  onUnmute: () => void;
  onAddMembers: (subjects: ChatMemberSubject[]) => void;
  onRemoveMember: (subject: ChatMemberSubject) => void;
  onMoveToCategory: (categoryId: string | undefined) => void;
  onArchive: () => void;
  onDelete: () => void;
  onLeave: () => void;
  onShowAgentContext?: (agentId: string) => void;
}) {
  const [renaming, setRenaming] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [addingMembers, setAddingMembers] = useState(false);
  const [pickingCategory, setPickingCategory] = useState(false);

  const memberUserIds = useMemo(
    () => (visible ? members.filter((m) => m.subjectType === "USER").map((m) => m.subjectId) : []),
    [members, visible],
  );
  const presenceByUser = usePresences(memberUserIds);

  const isDm = channel.channelType === "DIRECT" || channel.channelType === "GROUP_DM";
  const canManage =
    !isDm && (channel.currentUserRole === "OWNER" || channel.currentUserRole === "ADMIN");
  // Agent DM names are per-user custom names, so the human member can always rename.
  const canRename = canManage || channel.isAgentDm;
  const selfMember = members.find((m) => m.subjectId === currentUserId);

  const TypeIcon = channel.isAgentDm
    ? Robot
    : channel.channelType === "PRIVATE"
      ? Lock
      : isDm
        ? ChatCircle
        : Hash;

  const promptMute = () => {
    const now = Math.floor(Date.now() / 1000);
    Alert.alert("Mute channel", undefined, [
      { text: "Cancel", style: "cancel" },
      { text: "For 1 hour", onPress: () => onMute(now + 3600) },
      { text: "For 8 hours", onPress: () => onMute(now + 8 * 3600) },
      { text: "For 24 hours", onPress: () => onMute(now + 24 * 3600) },
      { text: "Until I turn it off", onPress: () => onMute(null) },
    ]);
  };

  const confirmDestructive = (title: string, action: () => void) => {
    Alert.alert(title, "This cannot be undone.", [
      { text: "Cancel", style: "cancel" },
      { text: "Confirm", style: "destructive", onPress: action },
    ]);
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={onClose} />
      <View style={[styles.sheet, { backgroundColor: T.surface }]}>
        <View style={[styles.handle, { backgroundColor: T.border }]} />
        <ScrollView style={styles.scroll} keyboardShouldPersistTaps="handled">
          <View style={styles.header}>
            <View style={[styles.typeIcon, { backgroundColor: T.domains.chatSoft }]}>
              <TypeIcon size={20} color={T.domains.chat} weight="duotone" />
            </View>
            <View style={{ flex: 1 }}>
              {renaming ? (
                <View style={styles.renameRow}>
                  <TextInput
                    value={nameDraft}
                    onChangeText={setNameDraft}
                    autoFocus
                    style={[
                      styles.renameInput,
                      { color: T.textBright, backgroundColor: T.bg, borderColor: T.border },
                    ]}
                  />
                  <TouchableOpacity
                    onPress={() => {
                      const trimmed = nameDraft.trim();
                      if (trimmed && trimmed !== channel.displayName) onRename(trimmed);
                      setRenaming(false);
                    }}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  >
                    <Check size={18} color={T.green} weight="bold" />
                  </TouchableOpacity>
                </View>
              ) : (
                <View style={styles.titleRow}>
                  <Text style={[styles.title, { color: T.textBright }]} numberOfLines={1}>
                    {channel.displayName}
                  </Text>
                  {canRename ? (
                    <TouchableOpacity
                      onPress={() => {
                        setNameDraft(channel.isAgentDm ? channel.displayName : channel.name);
                        setRenaming(true);
                      }}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    >
                      <PencilSimple size={15} color={T.textDim} weight="duotone" />
                    </TouchableOpacity>
                  ) : null}
                </View>
              )}
              <Text style={[styles.subtitle, { color: T.textDim }]}>
                {channel.channelType === "PUBLIC"
                  ? "Public channel"
                  : channel.channelType === "PRIVATE"
                    ? "Private channel"
                    : channel.channelType === "GROUP_DM"
                      ? "Group message"
                      : "Direct message"}
                {" · "}
                {channel.memberCount} {channel.memberCount === 1 ? "member" : "members"}
              </Text>
            </View>
          </View>

          {channel.description ? (
            <Text style={[styles.description, { color: T.text }]}>{channel.description}</Text>
          ) : null}

          <Text style={[styles.sectionLabel, { color: T.textDim }]}>NOTIFICATIONS</Text>
          <View style={styles.levelRow}>
            {NOTIFICATION_LEVELS.map(({ key, label }) => {
              const active = (selfMember?.notificationLevel ?? "ALL") === key;
              return (
                <TouchableOpacity
                  key={key}
                  style={[
                    styles.levelPill,
                    active
                      ? { backgroundColor: T.domains.chat }
                      : {
                          backgroundColor: T.bg,
                          borderColor: T.border,
                          borderWidth: StyleSheet.hairlineWidth,
                        },
                  ]}
                  onPress={() => onSetNotificationLevel(key)}
                  activeOpacity={0.7}
                >
                  <Text style={[styles.levelPillText, { color: active ? "#fff" : T.textDim }]}>
                    {label}
                  </Text>
                </TouchableOpacity>
              );
            })}
            <TouchableOpacity
              style={[
                styles.levelPill,
                styles.muteBtn,
                { backgroundColor: T.bg, borderColor: T.border },
              ]}
              onPress={() => (selfMember?.isMuted ? onUnmute() : promptMute())}
              activeOpacity={0.7}
            >
              {selfMember?.isMuted ? (
                <Bell size={13} color={T.textDim} weight="bold" />
              ) : (
                <BellSlash size={13} color={T.textDim} weight="bold" />
              )}
              <Text style={[styles.levelPillText, { color: T.textDim }]}>
                {selfMember?.isMuted ? "Unmute" : "Mute"}
              </Text>
            </TouchableOpacity>
          </View>

          <View style={styles.membersHeader}>
            <Text style={[styles.sectionLabel, { color: T.textDim }]}>MEMBERS</Text>
            {canManage ? (
              <TouchableOpacity
                onPress={() => setAddingMembers(true)}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                style={styles.addMembersBtn}
              >
                <UserPlus size={14} color={T.domains.chat} weight="bold" />
                <Text style={[styles.addMembersText, { color: T.domains.chat }]}>Add</Text>
              </TouchableOpacity>
            ) : null}
          </View>
          {members.map((m) => (
            <View key={m.subjectId} style={[styles.memberRow, { borderTopColor: T.border }]}>
              <Avatar
                name={m.displayName}
                avatarUrl={m.avatarUrl ?? undefined}
                size={30}
                presence={
                  m.subjectType === "USER" ? (presenceByUser[m.subjectId] ?? "offline") : null
                }
                presenceRingColor={T.surface}
              />
              <Text style={[styles.memberName, { color: T.textBright }]} numberOfLines={1}>
                {m.displayName}
                {m.subjectId === currentUserId ? " (you)" : ""}
              </Text>
              {m.subjectType === "AGENT" ? (
                <View style={[styles.roleTag, { backgroundColor: T.domains.agentsSoft }]}>
                  <Text style={[styles.roleTagText, { color: T.domains.agents }]}>AGENT</Text>
                </View>
              ) : null}
              {m.role !== "MEMBER" ? (
                <View style={[styles.roleTag, { backgroundColor: T.domains.chatSoft }]}>
                  <Text style={[styles.roleTagText, { color: T.domains.chat }]}>{m.role}</Text>
                </View>
              ) : null}
              {m.subjectType === "AGENT" && onShowAgentContext ? (
                <TouchableOpacity
                  onPress={() => onShowAgentContext(m.subjectId)}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  accessibilityRole="button"
                  accessibilityLabel={`Context usage for ${m.displayName}`}
                >
                  <Gauge size={16} color={T.textDim} weight="duotone" />
                </TouchableOpacity>
              ) : null}
              {canManage && m.subjectId !== currentUserId ? (
                <TouchableOpacity
                  onPress={() =>
                    Alert.alert("Remove member", `Remove ${m.displayName} from the channel?`, [
                      { text: "Cancel", style: "cancel" },
                      {
                        text: "Remove",
                        style: "destructive",
                        onPress: () => onRemoveMember({ kind: m.subjectType, id: m.subjectId }),
                      },
                    ])
                  }
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <X size={15} color={T.textDim} weight="bold" />
                </TouchableOpacity>
              ) : null}
            </View>
          ))}

          {canManage || (!isDm && selfMember) ? (
            <Text style={[styles.sectionLabel, { color: T.textDim }]}>ACTIONS</Text>
          ) : null}
          {canManage ? (
            <>
              <ActionRow
                T={T}
                icon={<FolderSimple size={17} color={T.text} weight="duotone" />}
                label="Move to category"
                onPress={() => setPickingCategory(true)}
              />
              <ActionRow
                T={T}
                icon={<Archive size={17} color={T.text} weight="duotone" />}
                label="Archive channel"
                onPress={() => confirmDestructive("Archive channel", onArchive)}
              />
              <ActionRow
                T={T}
                icon={<Trash size={17} color={T.red} weight="duotone" />}
                label="Delete channel"
                danger
                onPress={() => confirmDestructive("Delete channel", onDelete)}
              />
            </>
          ) : null}
          {!isDm && selfMember && channel.currentUserRole !== "OWNER" ? (
            <ActionRow
              T={T}
              icon={<SignOut size={17} color={T.red} weight="duotone" />}
              label="Leave channel"
              danger
              onPress={() =>
                Alert.alert("Leave channel", `Leave #${channel.name}?`, [
                  { text: "Cancel", style: "cancel" },
                  { text: "Leave", style: "destructive", onPress: onLeave },
                ])
              }
            />
          ) : null}
          <View style={styles.bottomPad} />
        </ScrollView>
      </View>

      <AddMembersModal
        visible={addingMembers}
        T={T}
        directory={directory}
        existingIds={members.map((m) => m.subjectId)}
        onClose={() => setAddingMembers(false)}
        onAdd={(subjects) => {
          setAddingMembers(false);
          if (subjects.length > 0) onAddMembers(subjects);
        }}
      />

      <CategoryPickerModal
        visible={pickingCategory}
        T={T}
        categories={categories}
        currentCategoryId={channel.categoryId}
        onClose={() => setPickingCategory(false)}
        onPick={(categoryId) => {
          setPickingCategory(false);
          onMoveToCategory(categoryId);
        }}
      />
    </Modal>
  );
}

function ActionRow({
  T,
  icon,
  label,
  danger,
  onPress,
}: {
  T: ThemeColors;
  icon: React.ReactNode;
  label: string;
  danger?: boolean;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity
      style={[styles.actionRow, { borderTopColor: T.border }]}
      onPress={onPress}
      activeOpacity={0.7}
    >
      {icon}
      <Text style={[styles.actionLabel, { color: danger ? T.red : T.textBright }]}>{label}</Text>
    </TouchableOpacity>
  );
}

function AddMembersModal({
  visible,
  T,
  directory,
  existingIds,
  onClose,
  onAdd,
}: {
  visible: boolean;
  T: ThemeColors;
  directory: DirectorySubject[];
  existingIds: string[];
  onClose: () => void;
  onAdd: (subjects: ChatMemberSubject[]) => void;
}) {
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const candidates = useMemo(() => {
    const existing = new Set(existingIds);
    const q = search.trim().toLowerCase();
    const matching = directory
      .filter((s) => !existing.has(s.id))
      .filter(
        (s) => !q || s.name.toLowerCase().includes(q) || (s.email ?? "").toLowerCase().includes(q),
      );
    // People first, then agents, so the sections read in a stable order.
    return [
      ...matching.filter((s) => s.kind !== "AGENT"),
      ...matching.filter((s) => s.kind === "AGENT"),
    ];
  }, [directory, existingIds, search]);

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={onClose} />
      <View style={[styles.sheet, { backgroundColor: T.surface }]}>
        <View style={[styles.handle, { backgroundColor: T.border }]} />
        <View style={styles.pickerHeader}>
          <Text style={[styles.pickerTitle, { color: T.textBright }]}>Add members</Text>
          <TouchableOpacity onPress={onClose} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <X size={18} color={T.textDim} weight="bold" />
          </TouchableOpacity>
        </View>
        <View style={[styles.searchBox, { backgroundColor: T.bg, borderColor: T.border }]}>
          <MagnifyingGlass size={16} color={T.textDim} weight="bold" />
          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder="Search people"
            placeholderTextColor={T.textDim}
            style={[styles.searchInput, { color: T.textBright }]}
          />
        </View>
        <ScrollView style={styles.pickerList} keyboardShouldPersistTaps="handled">
          {candidates.map((s) => {
            const active = selected.has(s.id);
            const isAgent = s.kind === "AGENT";
            return (
              <TouchableOpacity
                key={s.id}
                style={[styles.memberRow, { borderTopColor: T.border }]}
                onPress={() => toggle(s.id)}
                activeOpacity={0.7}
              >
                {isAgent ? (
                  <View style={[styles.agentPickerIcon, { backgroundColor: T.domains.agentsSoft }]}>
                    <Robot size={16} color={T.domains.agents} weight="fill" />
                  </View>
                ) : (
                  <Avatar name={s.name} avatarUrl={s.avatarUrl} size={30} />
                )}
                <Text style={[styles.memberName, { color: T.textBright }]} numberOfLines={1}>
                  {s.name}
                </Text>
                {isAgent ? (
                  <View style={[styles.roleTag, { backgroundColor: T.domains.agentsSoft }]}>
                    <Text style={[styles.roleTagText, { color: T.domains.agents }]}>AGENT</Text>
                  </View>
                ) : null}
                <View
                  style={[
                    styles.checkbox,
                    active
                      ? { backgroundColor: T.domains.chat, borderColor: T.domains.chat }
                      : { borderColor: T.border },
                  ]}
                >
                  {active ? <Check size={12} color="#fff" weight="bold" /> : null}
                </View>
              </TouchableOpacity>
            );
          })}
          {candidates.length === 0 ? (
            <Text style={[styles.pickerEmpty, { color: T.textDim }]}>No people found</Text>
          ) : null}
        </ScrollView>
        <TouchableOpacity
          style={[
            styles.cta,
            { backgroundColor: selected.size > 0 ? T.domains.chat : T.surfaceHover },
          ]}
          disabled={selected.size === 0}
          onPress={() => {
            const byId = new Map(directory.map((s) => [s.id, s]));
            onAdd(
              [...selected].map((id) => ({
                kind: byId.get(id)?.kind === "AGENT" ? "AGENT" : "USER",
                id,
              })),
            );
            setSelected(new Set());
            setSearch("");
          }}
          activeOpacity={0.8}
        >
          <Text style={[styles.ctaText, { color: selected.size > 0 ? "#fff" : T.textDim }]}>
            Add {selected.size > 0 ? `${selected.size} ` : ""}
            {selected.size === 1 ? "member" : "members"}
          </Text>
        </TouchableOpacity>
      </View>
    </Modal>
  );
}

function CategoryPickerModal({
  visible,
  T,
  categories,
  currentCategoryId,
  onClose,
  onPick,
}: {
  visible: boolean;
  T: ThemeColors;
  categories: SerializedCategory[];
  currentCategoryId: string | null;
  onClose: () => void;
  onPick: (categoryId: string | undefined) => void;
}) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={onClose} />
      <View style={[styles.sheet, { backgroundColor: T.surface }]}>
        <View style={[styles.handle, { backgroundColor: T.border }]} />
        <View style={styles.pickerHeader}>
          <Text style={[styles.pickerTitle, { color: T.textBright }]}>Move to category</Text>
          <TouchableOpacity onPress={onClose} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <X size={18} color={T.textDim} weight="bold" />
          </TouchableOpacity>
        </View>
        <TouchableOpacity
          style={[styles.actionRow, { borderTopColor: T.border }]}
          onPress={() => onPick(undefined)}
          activeOpacity={0.7}
        >
          <Text style={[styles.actionLabel, { color: T.textBright }]}>No category</Text>
          {!currentCategoryId ? <Check size={15} color={T.domains.chat} weight="bold" /> : null}
        </TouchableOpacity>
        {categories.map((cat) => (
          <TouchableOpacity
            key={cat.id}
            style={[styles.actionRow, { borderTopColor: T.border }]}
            onPress={() => onPick(cat.id)}
            activeOpacity={0.7}
          >
            <Text style={[styles.actionLabel, { color: T.textBright }]}>{cat.name}</Text>
            {currentCategoryId === cat.id ? (
              <Check size={15} color={T.domains.chat} weight="bold" />
            ) : null}
          </TouchableOpacity>
        ))}
        <View style={styles.bottomPad} />
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)" },
  sheet: { borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingBottom: 24, maxHeight: "85%" },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    alignSelf: "center",
    marginTop: 8,
    marginBottom: 8,
  },
  scroll: { paddingHorizontal: 20 },
  header: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 6 },
  typeIcon: {
    width: 42,
    height: 42,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  titleRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  title: { fontSize: 17, fontFamily: FONT.bold, flexShrink: 1 },
  subtitle: { fontSize: 12, fontFamily: FONT.regular, marginTop: 2 },
  renameRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  renameInput: {
    flex: 1,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 10,
    paddingVertical: 6,
    fontSize: 15,
    fontFamily: FONT.semibold,
  },
  description: { fontSize: 13, fontFamily: FONT.regular, lineHeight: 19, paddingVertical: 6 },
  sectionLabel: {
    fontSize: 11,
    fontFamily: FONT.semibold,
    letterSpacing: 0.8,
    marginTop: 16,
    marginBottom: 8,
  },
  levelRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  levelPill: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 16 },
  levelPillText: { fontSize: 12, fontFamily: FONT.semibold },
  muteBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    borderWidth: StyleSheet.hairlineWidth,
  },
  membersHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  addMembersBtn: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 16 },
  addMembersText: { fontSize: 12, fontFamily: FONT.semibold },
  memberRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 9,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  memberName: { flex: 1, fontSize: 14, fontFamily: FONT.medium },
  roleTag: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 5 },
  roleTagText: { fontSize: 9, fontFamily: FONT.bold, letterSpacing: 0.4 },
  actionRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 13,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  actionLabel: { flex: 1, fontSize: 14, fontFamily: FONT.medium },
  bottomPad: { height: 12 },
  pickerHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingBottom: 10,
  },
  pickerTitle: { fontSize: 16, fontFamily: FONT.semibold },
  searchBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginHorizontal: 20,
    marginBottom: 6,
    paddingHorizontal: 12,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
  },
  searchInput: { flex: 1, paddingVertical: 9, fontSize: 14, fontFamily: FONT.regular },
  pickerList: { maxHeight: 320, paddingHorizontal: 20 },
  pickerEmpty: {
    fontSize: 13,
    fontFamily: FONT.regular,
    textAlign: "center",
    paddingVertical: 20,
  },
  checkbox: {
    width: 20,
    height: 20,
    borderRadius: 6,
    borderWidth: 1.5,
    alignItems: "center",
    justifyContent: "center",
  },
  agentPickerIcon: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
  },
  cta: {
    marginHorizontal: 20,
    marginTop: 10,
    paddingVertical: 13,
    borderRadius: 12,
    alignItems: "center",
  },
  ctaText: { fontSize: 14, fontFamily: FONT.semibold },
});
