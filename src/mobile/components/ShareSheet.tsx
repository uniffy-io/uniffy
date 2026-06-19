import React, { useState, useMemo, useCallback } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Modal,
  ScrollView,
  ActivityIndicator,
  Alert,
} from "react-native";
import {
  ShareNetwork,
  X,
  Lock,
  Users,
  Globe,
  Check,
  MagnifyingGlass,
  Crown,
  UsersThree,
} from "phosphor-react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Avatar } from "@/components/Avatar";
import { useTheme } from "@/hooks/useTheme";
import type { ThemeColors } from "@/constants/theme";
import { useAuth } from "@/context/auth-context";
import { useMembers, useDirectory, useMemberMutations } from "@/hooks/usePermissions";
import {
  ACCESS_MODE_META,
  ASSIGNABLE_ROLES,
  ROLE_LABEL,
  canManage,
  isOwner as isOwnerRole,
  type AccessModeName,
  type RoleName,
  type SerializedMember,
} from "@/lib/permissionSerializer";
import type { ContentType } from "@uniffy/proto/common/v1/common_pb";

const ACCESS_ICON: Record<AccessModeName, typeof Lock> = {
  OWNER_ONLY: Lock,
  EXPLICIT_MEMBERS: Users,
  OPEN_TO_ORG: Globe,
};

const BASELINE_ROLES: RoleName[] = ["VIEWER", "COMMENTER", "EDITOR"];

/** Header button that opens the share sheet for any content. */
export function ShareButton({
  contentType,
  contentId,
  color,
}: {
  contentType: ContentType;
  contentId: string;
  color: string;
}) {
  const T = useTheme();
  const [open, setOpen] = useState(false);
  return (
    <>
      <TouchableOpacity
        onPress={() => setOpen(true)}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      >
        <ShareNetwork size={19} color={T.text} weight="regular" />
      </TouchableOpacity>
      <ShareSheet
        visible={open}
        onClose={() => setOpen(false)}
        contentType={contentType}
        contentId={contentId}
        color={color}
      />
    </>
  );
}

export function ShareSheet({
  visible,
  onClose,
  contentType,
  contentId,
  color,
}: {
  visible: boolean;
  onClose: () => void;
  contentType: ContentType;
  contentId: string;
  color: string;
}) {
  const T = useTheme();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const membersQuery = useMembers(contentType, contentId);
  const directory = useDirectory();
  const { addMember, updateRole, removeMember, setAccessMode, transferOwnership } =
    useMemberMutations(contentType, contentId);

  const [search, setSearch] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const policy = membersQuery.data?.policy ?? null;
  const members = useMemo(() => membersQuery.data?.members ?? [], [membersQuery.data]);
  const manage = canManage(policy?.callerRole ?? null) || policy?.ownerId === user?.id;
  const callerIsOwner = policy?.ownerId === user?.id || isOwnerRole(policy?.callerRole ?? null);
  const accessMode = policy?.accessMode ?? "OWNER_ONLY";

  const memberIds = useMemo(() => new Set(members.map((m) => m.subjectId)), [members]);

  const searchResults = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (q.length < 1) return [];
    return directory.subjects
      .filter((s) => s.id !== policy?.ownerId && !memberIds.has(s.id))
      .filter((s) => s.name.toLowerCase().includes(q) || s.email?.toLowerCase().includes(q))
      .slice(0, 8);
  }, [search, directory.subjects, memberIds, policy?.ownerId]);

  const resolveName = useCallback(
    (id: string) => directory.byId.get(id)?.name ?? "Unknown",
    [directory.byId],
  );

  const ownerName = policy ? resolveName(policy.ownerId) : "";

  const handleSelectMode = (mode: AccessModeName) => {
    if (mode === accessMode) return;
    setAccessMode.mutate({ mode, baselineRole: mode === "OPEN_TO_ORG" ? "VIEWER" : undefined });
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.modalRoot}>
        <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={onClose} />
        <View style={[styles.sheet, { backgroundColor: T.pageBg, paddingBottom: insets.bottom || 8 }]}>
          <View style={[styles.header, { borderBottomColor: T.border }]}>
            <View style={[styles.handle, { backgroundColor: T.border }]} />
            <View style={styles.headerRow}>
              <Text style={[styles.title, { color: T.textBright }]}>Share</Text>
              <TouchableOpacity onPress={onClose} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <X size={20} color={T.textDim} weight="bold" />
              </TouchableOpacity>
            </View>
          </View>

          {membersQuery.isLoading ? (
            <View style={styles.loadingWrap}>
              <ActivityIndicator color={color} />
            </View>
          ) : (
            <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
              <Text style={[styles.sectionLabel, { color: T.textDim }]}>WHO CAN ACCESS</Text>
              <View style={styles.modeGroup}>
                {ACCESS_MODE_META.map((m) => {
                  const Icon = ACCESS_ICON[m.key];
                  const active = accessMode === m.key;
                  return (
                    <TouchableOpacity
                      key={m.key}
                      style={[
                        styles.modeCard,
                        {
                          backgroundColor: active ? color + "18" : T.surface,
                          borderColor: active ? color : T.border,
                        },
                      ]}
                      disabled={!manage}
                      onPress={() => handleSelectMode(m.key)}
                      activeOpacity={0.7}
                    >
                      <Icon size={20} color={active ? color : T.textDim} weight={active ? "fill" : "regular"} />
                      <View style={{ flex: 1 }}>
                        <Text style={[styles.modeLabel, { color: active ? color : T.textBright }]}>
                          {m.label}
                        </Text>
                        <Text style={[styles.modeDesc, { color: T.textDim }]}>{m.description}</Text>
                      </View>
                      {active ? <Check size={16} color={color} weight="bold" /> : null}
                    </TouchableOpacity>
                  );
                })}
              </View>

              {accessMode === "OPEN_TO_ORG" && manage ? (
                <View style={styles.baselineRow}>
                  <Text style={[styles.baselineLabel, { color: T.textDim }]}>Everyone can</Text>
                  <View style={styles.rolePills}>
                    {BASELINE_ROLES.map((r) => {
                      const active = (policy?.baselineRole ?? "VIEWER") === r;
                      return (
                        <TouchableOpacity
                          key={r}
                          style={[
                            styles.rolePill,
                            { backgroundColor: active ? color : T.bg, borderColor: active ? color : T.border },
                          ]}
                          onPress={() => setAccessMode.mutate({ mode: "OPEN_TO_ORG", baselineRole: r })}
                          activeOpacity={0.7}
                        >
                          <Text style={[styles.rolePillText, { color: active ? "#fff" : T.textDim }]}>
                            {ROLE_LABEL[r]}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                </View>
              ) : null}

              <Text style={[styles.sectionLabel, { color: T.textDim, marginTop: 22 }]}>PEOPLE</Text>

              <View style={[styles.ownerRow, { borderBottomColor: T.border }]}>
                <Avatar name={ownerName} avatarUrl={directory.byId.get(policy?.ownerId ?? "")?.avatarUrl} size={34} />
                <View style={{ flex: 1 }}>
                  <Text style={[styles.memberName, { color: T.textBright }]} numberOfLines={1}>
                    {ownerName}
                    {policy?.ownerId === user?.id ? " (you)" : ""}
                  </Text>
                  <Text style={[styles.memberSub, { color: T.textDim }]}>Owner</Text>
                </View>
                <Crown size={16} color="#f59e0b" weight="fill" />
              </View>

              {members.map((m) => (
                <MemberRow
                  key={`${m.subjectType}:${m.subjectId}`}
                  member={m}
                  name={resolveName(m.subjectId)}
                  avatarUrl={directory.byId.get(m.subjectId)?.avatarUrl}
                  T={T}
                  color={color}
                  manage={manage}
                  callerIsOwner={callerIsOwner}
                  expanded={expandedId === m.subjectId}
                  onToggleExpand={() => setExpandedId((id) => (id === m.subjectId ? null : m.subjectId))}
                  onChangeRole={(role) => {
                    updateRole.mutate({ subjectId: m.subjectId, subjectKind: m.subjectType, role });
                    setExpandedId(null);
                  }}
                  onRemove={() => {
                    removeMember.mutate({ subjectId: m.subjectId, subjectKind: m.subjectType });
                    setExpandedId(null);
                  }}
                  onTransfer={() => {
                    setExpandedId(null);
                    Alert.alert("Transfer ownership", `Make ${resolveName(m.subjectId)} the owner? You will become an admin.`, [
                      { text: "Cancel", style: "cancel" },
                      { text: "Transfer", style: "destructive", onPress: () => transferOwnership.mutate(m.subjectId) },
                    ]);
                  }}
                />
              ))}

              {members.length === 0 ? (
                <Text style={[styles.noMembers, { color: T.textDim }]}>No one else has access yet</Text>
              ) : null}

              {manage ? (
                <>
                  <Text style={[styles.sectionLabel, { color: T.textDim, marginTop: 22 }]}>ADD PEOPLE</Text>
                  <View style={[styles.searchRow, { backgroundColor: T.surface, borderColor: T.border }]}>
                    <MagnifyingGlass size={16} color={T.textDim} weight="bold" />
                    <TextInput
                      value={search}
                      onChangeText={setSearch}
                      placeholder="Search people and groups..."
                      placeholderTextColor={T.textDim}
                      style={[styles.searchInput, { color: T.textBright }]}
                      autoCapitalize="none"
                    />
                    {search.length > 0 ? (
                      <TouchableOpacity onPress={() => setSearch("")}>
                        <X size={14} color={T.textDim} weight="bold" />
                      </TouchableOpacity>
                    ) : null}
                  </View>
                  {searchResults.map((s) => (
                    <TouchableOpacity
                      key={`${s.kind}:${s.id}`}
                      style={[styles.resultRow, { borderBottomColor: T.border }]}
                      onPress={() => {
                        addMember.mutate({ subjectId: s.id, subjectKind: s.kind, role: "VIEWER" });
                        setSearch("");
                      }}
                      activeOpacity={0.7}
                    >
                      {s.kind === "GROUP" ? (
                        <View style={[styles.groupAvatar, { backgroundColor: "#8b5cf622" }]}>
                          <UsersThree size={16} color="#8b5cf6" weight="fill" />
                        </View>
                      ) : (
                        <Avatar name={s.name} avatarUrl={s.avatarUrl} size={32} />
                      )}
                      <View style={{ flex: 1 }}>
                        <Text style={[styles.memberName, { color: T.textBright }]} numberOfLines={1}>
                          {s.name}
                        </Text>
                        <Text style={[styles.memberSub, { color: T.textDim }]} numberOfLines={1}>
                          {s.kind === "GROUP" ? `${s.memberCount ?? 0} members` : s.email}
                        </Text>
                      </View>
                      <Text style={[styles.addLabel, { color }]}>Add</Text>
                    </TouchableOpacity>
                  ))}
                  {search.trim().length > 0 && searchResults.length === 0 && !directory.isLoading ? (
                    <Text style={[styles.noMembers, { color: T.textDim }]}>No matches</Text>
                  ) : null}
                </>
              ) : null}
            </ScrollView>
          )}
        </View>
      </View>
    </Modal>
  );
}

function MemberRow({
  member,
  name,
  avatarUrl,
  T,
  color,
  manage,
  callerIsOwner,
  expanded,
  onToggleExpand,
  onChangeRole,
  onRemove,
  onTransfer,
}: {
  member: SerializedMember;
  name: string;
  avatarUrl?: string;
  T: ThemeColors;
  color: string;
  manage: boolean;
  callerIsOwner: boolean;
  expanded: boolean;
  onToggleExpand: () => void;
  onChangeRole: (role: RoleName) => void;
  onRemove: () => void;
  onTransfer: () => void;
}) {
  return (
    <View style={[styles.memberRow, { borderBottomColor: T.border }]}>
      <View style={styles.memberMain}>
        {member.subjectType === "GROUP" ? (
          <View style={[styles.groupAvatar, { backgroundColor: "#8b5cf622" }]}>
            <UsersThree size={16} color="#8b5cf6" weight="fill" />
          </View>
        ) : (
          <Avatar name={name} avatarUrl={avatarUrl} size={34} />
        )}
        <View style={{ flex: 1 }}>
          <Text style={[styles.memberName, { color: T.textBright }]} numberOfLines={1}>
            {name}
          </Text>
          <Text style={[styles.memberSub, { color: T.textDim }]}>
            {member.subjectType === "GROUP" ? "Group" : "Member"}
          </Text>
        </View>
        <TouchableOpacity
          style={[styles.roleChip, { backgroundColor: T.surfaceHover, borderColor: T.border }]}
          disabled={!manage}
          onPress={onToggleExpand}
          activeOpacity={0.7}
        >
          <Text style={[styles.roleChipText, { color: T.text }]}>
            {member.role === "BLOCKED" ? "Blocked" : ROLE_LABEL[member.role]}
          </Text>
        </TouchableOpacity>
      </View>

      {expanded && manage ? (
        <View style={styles.roleOptions}>
          {ASSIGNABLE_ROLES.map((r) => {
            const active = member.role === r;
            return (
              <TouchableOpacity
                key={r}
                style={[
                  styles.roleOption,
                  { backgroundColor: active ? color : T.bg, borderColor: active ? color : T.border },
                ]}
                onPress={() => onChangeRole(r)}
                activeOpacity={0.7}
              >
                <Text style={[styles.roleOptionText, { color: active ? "#fff" : T.textDim }]}>
                  {ROLE_LABEL[r]}
                </Text>
              </TouchableOpacity>
            );
          })}
          {callerIsOwner && member.subjectType === "USER" ? (
            <TouchableOpacity
              style={[styles.roleOption, { backgroundColor: T.bg, borderColor: T.border }]}
              onPress={onTransfer}
              activeOpacity={0.7}
            >
              <Text style={[styles.roleOptionText, { color: "#f59e0b" }]}>Make owner</Text>
            </TouchableOpacity>
          ) : null}
          <TouchableOpacity
            style={[styles.roleOption, { backgroundColor: T.bg, borderColor: T.border }]}
            onPress={onRemove}
            activeOpacity={0.7}
          >
            <Text style={[styles.roleOptionText, { color: "#FA5252" }]}>Remove</Text>
          </TouchableOpacity>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  modalRoot: { flex: 1, justifyContent: "flex-end" },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0,0,0,0.5)" },
  sheet: { maxHeight: "88%", borderTopLeftRadius: 20, borderTopRightRadius: 20, overflow: "hidden" },
  header: { borderBottomWidth: StyleSheet.hairlineWidth, paddingBottom: 10 },
  handle: { width: 36, height: 4, borderRadius: 2, alignSelf: "center", marginTop: 8, marginBottom: 8 },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
  },
  title: { fontSize: 16, fontFamily: "Inter_700Bold" },
  loadingWrap: { padding: 40, alignItems: "center" },
  content: { padding: 16 },
  sectionLabel: { fontSize: 11, fontFamily: "Inter_600SemiBold", letterSpacing: 0.8, marginBottom: 10 },
  modeGroup: { gap: 8 },
  modeCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 13,
    borderRadius: 12,
    borderWidth: 1,
  },
  modeLabel: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  modeDesc: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
  baselineRow: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 12 },
  baselineLabel: { fontSize: 13, fontFamily: "Inter_500Medium" },
  rolePills: { flexDirection: "row", gap: 6, flex: 1 },
  rolePill: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, borderWidth: 1 },
  rolePillText: { fontSize: 12, fontFamily: "Inter_500Medium" },
  ownerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 11,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  memberRow: { borderBottomWidth: StyleSheet.hairlineWidth },
  memberMain: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 11 },
  memberName: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  memberSub: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
  groupAvatar: { width: 34, height: 34, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  roleChip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, borderWidth: StyleSheet.hairlineWidth },
  roleChipText: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  roleOptions: { flexDirection: "row", flexWrap: "wrap", gap: 8, paddingBottom: 12 },
  roleOption: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, borderWidth: 1 },
  roleOptionText: { fontSize: 12, fontFamily: "Inter_500Medium" },
  noMembers: { fontSize: 13, fontFamily: "Inter_400Regular", paddingVertical: 12 },
  searchRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 12,
    height: 44,
  },
  searchInput: { flex: 1, fontSize: 15, fontFamily: "Inter_400Regular" },
  resultRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 11,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  addLabel: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
});
