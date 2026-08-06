import React, { useState, useCallback, useMemo } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  FlatList,
  Platform,
  ScrollView,
  ActivityIndicator,
  RefreshControl,
  Alert,
} from "react-native";
import {
  Plus,
  Hash,
  Lock,
  ChatCircle,
  Robot,
  ChatTeardropText,
  Compass,
  CaretDown,
  CaretRight,
  ChatText,
  FolderPlus,
  FolderSimple,
  X,
  Check,
  MagnifyingGlass,
  PencilSimple,
  Phone,
} from "phosphor-react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { DomainHeader } from "@shared/components/DomainHeader";
import { Avatar } from "@shared/components/Avatar";
import { BottomSheet } from "@shared/components/BottomSheet";
import { useTheme } from "@shared/hooks/useTheme";
import { BOTTOM_NAV_HEIGHT } from "@theme/theme";
import type { ThemeColors } from "@theme/theme";
import { FONT } from "@theme/typography";
import {
  useChannels,
  useAgentChats,
  useThreadsInbox,
  useBrowseChannels,
  useCategories,
  useAgentFolders,
} from "@features/chat/useChat";
import {
  useJoinChannel,
  useCreateCategory,
  useCreateDm,
  useUpdateCategory,
  useDeleteCategory,
  useCreateAgentFolder,
  useRenameAgentFolder,
  useDeleteAgentFolder,
  useSetAgentChatFolder,
} from "@features/chat/useChatMutations";
import { useChatStream } from "@features/chat/useChatStream";
import { useAgents, useCreateAgentChat } from "@features/agents/useAgents";
import type { SerializedAgent } from "@features/agents/agentSerializer";
import { useActiveCall } from "@features/calls/useCallsState";
import { useDirectory } from "@shared/permissions/usePermissions";
import { usePresences } from "@shared/presence/usePresence";
import { useAuth } from "@core/providers/AuthContext";
import { PresenceDot } from "@shared/presence/PresenceDot";
import {
  formatChannelActivity,
  type SerializedChannel,
  type SerializedThreadInboxItem,
  type SerializedCategory,
  type SerializedAgentFolder,
} from "@features/chat/chatSerializer";

type Tab = "all" | "threads" | "unreads";

const TABS: { key: Tab; label: string }[] = [
  { key: "all", label: "All" },
  { key: "threads", label: "Threads" },
  { key: "unreads", label: "Unreads" },
];

function ChannelIcon({ channel, color }: { channel: SerializedChannel; color: string }) {
  const size = 16;
  if (channel.isAgentDm) return <Robot size={size} color={color} weight="fill" />;
  if (channel.channelType === "DIRECT" || channel.channelType === "GROUP_DM")
    return <ChatCircle size={size} color={color} weight="fill" />;
  if (channel.channelType === "PRIVATE") return <Lock size={size} color={color} weight="fill" />;
  return <Hash size={size} color={color} weight="bold" />;
}

export function ChatListScreen() {
  const T = useTheme();
  const insets = useSafeAreaInsets();
  const bottomPad =
    Platform.OS === "web" ? BOTTOM_NAV_HEIGHT + 34 : BOTTOM_NAV_HEIGHT + insets.bottom;
  const [tab, setTab] = useState<Tab>("all");
  const [browsing, setBrowsing] = useState(false);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const [newCategoryOpen, setNewCategoryOpen] = useState(false);
  const [newDmOpen, setNewDmOpen] = useState(false);
  const [newAgentChatOpen, setNewAgentChatOpen] = useState(false);

  useChatStream();
  const { channels, isLoading, isFetching, refetch } = useChannels();
  const { agentChats: agentChatList } = useAgentChats();
  const categories = useCategories();
  const threads = useThreadsInbox(tab === "threads");
  const browse = useBrowseChannels(browsing);
  const joinChannel = useJoinChannel();
  const createCategory = useCreateCategory();
  const createDm = useCreateDm();
  const createAgentChat = useCreateAgentChat();
  const agentFolders = useAgentFolders();
  const createAgentFolder = useCreateAgentFolder();
  const renameAgentFolder = useRenameAgentFolder();
  const deleteAgentFolder = useDeleteAgentFolder();
  const setAgentChatFolder = useSetAgentChatFolder();
  const updateCategory = useUpdateCategory();
  const deleteCategory = useDeleteCategory();

  const [renameCategoryTarget, setRenameCategoryTarget] = useState<SerializedCategory | null>(null);
  const [newAgentFolderOpen, setNewAgentFolderOpen] = useState(false);
  const [renameFolderTarget, setRenameFolderTarget] = useState<SerializedAgentFolder | null>(null);
  const [moveChatTarget, setMoveChatTarget] = useState<SerializedChannel | null>(null);

  const promptCategoryActions = useCallback(
    (category: SerializedCategory) => {
      Alert.alert(category.name, undefined, [
        { text: "Cancel", style: "cancel" },
        { text: "Rename", onPress: () => setRenameCategoryTarget(category) },
        {
          text: "Delete",
          style: "destructive",
          onPress: () =>
            Alert.alert("Delete category", "Channels move back to the top level.", [
              { text: "Cancel", style: "cancel" },
              {
                text: "Delete",
                style: "destructive",
                onPress: () => deleteCategory.mutate(category.id),
              },
            ]),
        },
      ]);
    },
    [deleteCategory],
  );

  const openChannel = useCallback((id: string) => router.push(`/chat/${id}` as any), []);

  // Agent chats arrive via both ListChannels (is_agent_dm) and ListAgentChats; merge + dedupe.
  const agentChats = useMemo(() => {
    const byId = new Map<string, SerializedChannel>();
    for (const c of channels) if (c.isAgentDm) byId.set(c.id, c);
    for (const c of agentChatList) if (!byId.has(c.id)) byId.set(c.id, c);
    return [...byId.values()].sort((a, b) => b.lastMessageAtSeconds - a.lastMessageAtSeconds);
  }, [channels, agentChatList]);

  const folders = useMemo(() => agentFolders.data ?? [], [agentFolders.data]);
  const agentChatsByFolder = useMemo(() => {
    const byFolder = new Map<string, SerializedChannel[]>();
    const unfiled: SerializedChannel[] = [];
    const known = new Set(folders.map((f) => f.id));
    for (const c of agentChats) {
      // A folder deleted on another device leaves a dangling id behind; those
      // chats belong at the root rather than in an invisible group.
      if (c.agentFolderId && known.has(c.agentFolderId)) {
        const list = byFolder.get(c.agentFolderId);
        if (list) list.push(c);
        else byFolder.set(c.agentFolderId, [c]);
      } else {
        unfiled.push(c);
      }
    }
    return { byFolder, unfiled };
  }, [agentChats, folders]);

  const promptFolderActions = useCallback(
    (folder: SerializedAgentFolder) => {
      Alert.alert(folder.name, undefined, [
        { text: "Cancel", style: "cancel" },
        { text: "Rename", onPress: () => setRenameFolderTarget(folder) },
        {
          text: "Delete",
          style: "destructive",
          onPress: () =>
            Alert.alert("Delete folder", "The chats inside move back to Agent Chats.", [
              { text: "Cancel", style: "cancel" },
              {
                text: "Delete",
                style: "destructive",
                onPress: () => deleteAgentFolder.mutate(folder.id),
              },
            ]),
        },
      ]);
    },
    [deleteAgentFolder],
  );

  const { uncategorized, dms } = useMemo(() => {
    const reg: SerializedChannel[] = [];
    const dm: SerializedChannel[] = [];
    for (const c of channels) {
      if (c.isAgentDm) continue;
      if (c.channelType === "DIRECT" || c.channelType === "GROUP_DM") dm.push(c);
      else if (!c.categoryId) reg.push(c);
    }
    return { uncategorized: reg, dms: dm };
  }, [channels]);

  const { user } = useAuth();
  const dmPeerIds = useMemo(() => {
    const ids = new Set<string>();
    for (const c of channels) {
      if (c.channelType !== "DIRECT") continue;
      for (const memberId of c.dmMemberIds) if (memberId !== user?.id) ids.add(memberId);
    }
    return [...ids];
  }, [channels, user?.id]);
  const presenceByUser = usePresences(dmPeerIds);
  const dmPresence = useCallback(
    (channel: SerializedChannel) => {
      if (channel.channelType !== "DIRECT") return null;
      const peerId = channel.dmMemberIds.find((memberId) => memberId !== user?.id);
      return peerId ? (presenceByUser[peerId] ?? "offline") : null;
    },
    [presenceByUser, user?.id],
  );
  const directory = useDirectory();
  const dmPeer = useCallback(
    (channel: SerializedChannel) => {
      if (channel.channelType !== "DIRECT") return null;
      const peerId = channel.dmMemberIds.find((memberId) => memberId !== user?.id);
      if (!peerId) return null;
      const subject = directory.byId.get(peerId);
      if (!subject?.name) return null;
      return { name: subject.name, avatarUrl: subject.avatarUrl };
    },
    [directory.byId, user?.id],
  );

  const categorized = useMemo(() => {
    const cats = categories.data ?? [];
    return cats.map((cat) => ({
      category: cat,
      channels: channels.filter(
        (c) =>
          !c.isAgentDm &&
          c.categoryId === cat.id &&
          c.channelType !== "DIRECT" &&
          c.channelType !== "GROUP_DM",
      ),
    }));
  }, [categories.data, channels]);

  const unreadList = useMemo(
    () =>
      [...channels, ...agentChats]
        .filter((c) => c.unreadCount > 0)
        .sort((a, b) => b.lastMessageAtSeconds - a.lastMessageAtSeconds),
    [channels, agentChats],
  );

  const joinedIds = useMemo(() => new Set(channels.map((c) => c.id)), [channels]);
  const browseList = (browse.data ?? []).filter((c) => !joinedIds.has(c.id));

  const toggle = useCallback(
    (section: string) => setCollapsed((prev) => ({ ...prev, [section]: !prev[section] })),
    [],
  );
  const handleJoin = useCallback(
    (id: string) => {
      joinChannel.mutate(id, {
        onSuccess: () => {
          setBrowsing(false);
          openChannel(id);
        },
      });
    },
    [joinChannel, openChannel],
  );

  const header = (
    <DomainHeader
      title="Chat"
      color={T.accent}
      icon="chat"
      rightActions={
        <>
          <TouchableOpacity
            onPress={() => setBrowsing((v) => !v)}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Compass size={21} color={browsing ? T.accent : T.text} weight="duotone" />
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => setNewCategoryOpen(true)}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Plus size={21} color={T.accent} weight="bold" />
          </TouchableOpacity>
        </>
      }
    />
  );

  if (browsing) {
    return (
      <View style={[styles.container, { backgroundColor: T.pageBg }]}>
        {header}
        <View style={[styles.browseBar, { borderBottomColor: T.border }]}>
          <Text style={[styles.browseTitle, { color: T.textBright }]}>Browse channels</Text>
          <TouchableOpacity onPress={() => setBrowsing(false)}>
            <Text style={[styles.browseClose, { color: T.accent }]}>Done</Text>
          </TouchableOpacity>
        </View>
        {browse.isLoading ? (
          <View style={styles.loadingWrap}>
            <ActivityIndicator size="large" color={T.accent} />
          </View>
        ) : (
          <FlatList
            data={browseList}
            keyExtractor={(item) => item.id}
            showsVerticalScrollIndicator={false}
            contentContainerStyle={[
              browseList.length === 0 ? styles.emptyContent : styles.listContent,
              { paddingBottom: bottomPad },
            ]}
            renderItem={({ item }) => (
              <BrowseRow
                channel={item}
                T={T}
                joining={joinChannel.isPending}
                onJoin={() => handleJoin(item.id)}
                onPress={() => openChannel(item.id)}
              />
            )}
            ListEmptyComponent={
              <View style={styles.sectionEmpty}>
                <Text style={[styles.sectionEmptyText, { color: T.textDim }]}>
                  No public channels to join
                </Text>
              </View>
            }
          />
        )}
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: T.pageBg }]}>
      {header}

      <View style={[styles.filterBar, { borderBottomColor: T.border }]}>
        {TABS.map(({ key, label }) => {
          const active = tab === key;
          return (
            <TouchableOpacity
              key={key}
              style={[
                styles.filterPill,
                active
                  ? { backgroundColor: T.accent }
                  : {
                      backgroundColor: T.surface,
                      borderColor: T.border,
                      borderWidth: StyleSheet.hairlineWidth,
                    },
              ]}
              onPress={() => setTab(key)}
              activeOpacity={0.7}
            >
              <Text style={[styles.filterPillText, { color: active ? "#fff" : T.textDim }]}>
                {label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {tab === "threads" ? (
        <ThreadsList
          threads={threads.data ?? []}
          loading={threads.isLoading}
          T={T}
          bottomPad={bottomPad}
          onOpen={(item) =>
            router.push(`/chat/thread/${item.rootMessageId}?channelId=${item.channelId}` as never)
          }
        />
      ) : tab === "unreads" ? (
        <FlatList
          data={unreadList}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <ChannelRow
              channel={item}
              T={T}
              onPress={() => openChannel(item.id)}
              presence={dmPresence(item)}
              peer={dmPeer(item)}
            />
          )}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={[
            unreadList.length === 0 ? styles.emptyContent : styles.listContent,
            { paddingBottom: bottomPad },
          ]}
          ListEmptyComponent={
            <View style={styles.sectionEmpty}>
              <Text style={[styles.sectionEmptyText, { color: T.textDim }]}>
                You are all caught up
              </Text>
            </View>
          }
        />
      ) : isLoading && channels.length === 0 ? (
        <View style={styles.loadingWrap}>
          <ActivityIndicator size="large" color={T.accent} />
        </View>
      ) : channels.length === 0 && agentChats.length === 0 ? (
        <EmptyChannels T={T} />
      ) : (
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={[styles.listContent, { paddingBottom: bottomPad }]}
          refreshControl={
            <RefreshControl
              refreshing={isFetching && !isLoading}
              onRefresh={() => refetch()}
              tintColor={T.accent}
              colors={[T.accent]}
            />
          }
        >
          <CategorySection
            label="Channels"
            count={uncategorized.length}
            collapsed={!!collapsed.channels}
            onToggle={() => toggle("channels")}
            T={T}
            onAdd={() => router.push("/chat/create" as any)}
          >
            {uncategorized.map((c) => (
              <ChannelRow key={c.id} channel={c} T={T} onPress={() => openChannel(c.id)} />
            ))}
          </CategorySection>

          {categorized.map(({ category, channels: catChannels }) => (
            <CategorySection
              key={category.id}
              label={category.name}
              count={catChannels.length}
              collapsed={!!collapsed[`cat-${category.id}`]}
              onToggle={() => toggle(`cat-${category.id}`)}
              onLongPress={() => promptCategoryActions(category)}
              T={T}
              onAdd={() => router.push("/chat/create" as any)}
            >
              {catChannels.map((c) => (
                <ChannelRow key={c.id} channel={c} T={T} onPress={() => openChannel(c.id)} />
              ))}
            </CategorySection>
          ))}

          <CategorySection
            label="Agent Chats"
            count={agentChats.length}
            collapsed={!!collapsed.agents}
            onToggle={() => toggle("agents")}
            hasContent={agentChats.length > 0 || folders.length > 0}
            T={T}
            onAddFolder={() => setNewAgentFolderOpen(true)}
            onAdd={() => setNewAgentChatOpen(true)}
          >
            {folders.map((folder) => {
              const folderChats = agentChatsByFolder.byFolder.get(folder.id) ?? [];
              return (
                <FolderGroup
                  key={folder.id}
                  T={T}
                  folder={folder}
                  count={folderChats.length}
                  collapsed={!!collapsed[`folder-${folder.id}`]}
                  onToggle={() => toggle(`folder-${folder.id}`)}
                  onLongPress={() => promptFolderActions(folder)}
                >
                  {folderChats.map((c) => (
                    <ChannelRow
                      key={c.id}
                      channel={c}
                      T={T}
                      onPress={() => openChannel(c.id)}
                      onLongPress={() => setMoveChatTarget(c)}
                    />
                  ))}
                </FolderGroup>
              );
            })}
            {agentChatsByFolder.unfiled.map((c) => (
              <ChannelRow
                key={c.id}
                channel={c}
                T={T}
                onPress={() => openChannel(c.id)}
                onLongPress={() => setMoveChatTarget(c)}
              />
            ))}
          </CategorySection>

          <CategorySection
            label="Direct Messages"
            count={dms.length}
            collapsed={!!collapsed.dms}
            onToggle={() => toggle("dms")}
            T={T}
            onAdd={() => setNewDmOpen(true)}
          >
            {dms.map((c) => (
              <ChannelRow
                key={c.id}
                channel={c}
                T={T}
                onPress={() => openChannel(c.id)}
                presence={dmPresence(c)}
                peer={dmPeer(c)}
              />
            ))}
          </CategorySection>
        </ScrollView>
      )}

      <CategoryNameModal
        visible={newCategoryOpen}
        T={T}
        pending={createCategory.isPending}
        title="New category"
        cta="Create category"
        onClose={() => setNewCategoryOpen(false)}
        onSubmit={(name) =>
          createCategory.mutate(name, { onSuccess: () => setNewCategoryOpen(false) })
        }
      />

      <CategoryNameModal
        key={renameCategoryTarget?.id ?? "rename"}
        visible={!!renameCategoryTarget}
        T={T}
        pending={updateCategory.isPending}
        title="Rename category"
        cta="Rename"
        initialName={renameCategoryTarget?.name}
        onClose={() => setRenameCategoryTarget(null)}
        onSubmit={(name) => {
          if (!renameCategoryTarget) return;
          updateCategory.mutate(
            { categoryId: renameCategoryTarget.id, name },
            { onSuccess: () => setRenameCategoryTarget(null) },
          );
        }}
      />

      <CategoryNameModal
        visible={newAgentFolderOpen}
        T={T}
        pending={createAgentFolder.isPending}
        title="New agent folder"
        cta="Create folder"
        placeholder="Folder name"
        onClose={() => setNewAgentFolderOpen(false)}
        onSubmit={(name) =>
          createAgentFolder.mutate(name, { onSuccess: () => setNewAgentFolderOpen(false) })
        }
      />

      <CategoryNameModal
        key={renameFolderTarget?.id ?? "rename-folder"}
        visible={!!renameFolderTarget}
        T={T}
        pending={renameAgentFolder.isPending}
        title="Rename folder"
        cta="Rename"
        placeholder="Folder name"
        initialName={renameFolderTarget?.name}
        onClose={() => setRenameFolderTarget(null)}
        onSubmit={(name) => {
          if (!renameFolderTarget) return;
          renameAgentFolder.mutate(
            { folderId: renameFolderTarget.id, name },
            { onSuccess: () => setRenameFolderTarget(null) },
          );
        }}
      />

      <MoveAgentChatModal
        key={moveChatTarget?.id ?? "move-chat"}
        visible={!!moveChatTarget}
        T={T}
        folders={folders}
        currentFolderId={moveChatTarget?.agentFolderId ?? null}
        pending={setAgentChatFolder.isPending}
        onClose={() => setMoveChatTarget(null)}
        onPick={(folderId) => {
          if (!moveChatTarget) return;
          setAgentChatFolder.mutate(
            { channelId: moveChatTarget.id, folderId },
            { onSuccess: () => setMoveChatTarget(null) },
          );
        }}
        onNewFolder={() => {
          setMoveChatTarget(null);
          setNewAgentFolderOpen(true);
        }}
      />

      <NewAgentChatModal
        visible={newAgentChatOpen}
        T={T}
        pendingId={createAgentChat.isPending ? (createAgentChat.variables ?? null) : null}
        onClose={() => setNewAgentChatOpen(false)}
        onPick={(agentId) =>
          createAgentChat.mutate(agentId, {
            onSuccess: (channelId) => {
              setNewAgentChatOpen(false);
              if (channelId) openChannel(channelId);
            },
          })
        }
      />

      <NewDmModal
        visible={newDmOpen}
        T={T}
        pending={createDm.isPending}
        onClose={() => setNewDmOpen(false)}
        onCreate={(userIds) =>
          createDm.mutate(userIds, {
            onSuccess: (res) => {
              setNewDmOpen(false);
              if (res.channel?.id) openChannel(res.channel.id);
            },
          })
        }
      />
    </View>
  );
}

function CategoryNameModal({
  visible,
  T,
  pending,
  title,
  cta,
  initialName,
  placeholder = "Category name",
  onClose,
  onSubmit,
}: {
  visible: boolean;
  T: ThemeColors;
  pending: boolean;
  title: string;
  cta: string;
  initialName?: string;
  placeholder?: string;
  onClose: () => void;
  onSubmit: (name: string) => void;
}) {
  const [name, setName] = useState(initialName ?? "");
  const trimmed = name.trim();
  return (
    <BottomSheet visible={visible} onClose={onClose} style={styles.sheet}>
      <View style={styles.sheetHeader}>
        <FolderPlus size={20} color={T.accent} weight="duotone" />
        <Text style={[styles.sheetTitle, { color: T.textBright }]}>{title}</Text>
      </View>
      <TextInput
        value={name}
        onChangeText={setName}
        placeholder={placeholder}
        placeholderTextColor={T.textDim}
        autoFocus
        style={[
          styles.modalInput,
          { color: T.textBright, backgroundColor: T.bg, borderColor: T.border },
        ]}
      />
      <TouchableOpacity
        style={[styles.modalCta, { backgroundColor: trimmed ? T.accent : T.surfaceHover }]}
        disabled={!trimmed || pending}
        onPress={() => {
          onSubmit(trimmed);
          setName("");
        }}
        activeOpacity={0.8}
      >
        <Text style={[styles.modalCtaText, { color: trimmed ? "#fff" : T.textDim }]}>
          {pending ? "Saving..." : cta}
        </Text>
      </TouchableOpacity>
    </BottomSheet>
  );
}

function MoveAgentChatModal({
  visible,
  T,
  folders,
  currentFolderId,
  pending,
  onClose,
  onPick,
  onNewFolder,
}: {
  visible: boolean;
  T: ThemeColors;
  folders: SerializedAgentFolder[];
  currentFolderId: string | null;
  pending: boolean;
  onClose: () => void;
  /** Omitted folder id moves the chat back to the unfiled root. */
  onPick: (folderId?: string) => void;
  onNewFolder: () => void;
}) {
  return (
    <BottomSheet visible={visible} onClose={onClose} style={styles.sheet}>
      <View style={styles.sheetHeader}>
        <FolderSimple size={20} color={T.accent} weight="duotone" />
        <Text style={[styles.sheetTitle, { color: T.textBright }]}>Move to folder</Text>
      </View>
      <ScrollView keyboardShouldPersistTaps="handled">
        <FolderPickRow
          T={T}
          label="Agent Chats"
          sublabel="No folder"
          selected={!currentFolderId}
          disabled={pending}
          onPress={() => onPick(undefined)}
        />
        {folders.map((folder) => (
          <FolderPickRow
            key={folder.id}
            T={T}
            label={folder.name}
            selected={currentFolderId === folder.id}
            disabled={pending}
            onPress={() => onPick(folder.id)}
          />
        ))}
        <TouchableOpacity style={styles.newFolderRow} onPress={onNewFolder} activeOpacity={0.7}>
          <FolderPlus size={17} color={T.accent} weight="duotone" />
          <Text style={[styles.newFolderText, { color: T.accent }]}>New folder</Text>
        </TouchableOpacity>
      </ScrollView>
    </BottomSheet>
  );
}

function FolderPickRow({
  T,
  label,
  sublabel,
  selected,
  disabled,
  onPress,
}: {
  T: ThemeColors;
  label: string;
  sublabel?: string;
  selected: boolean;
  disabled: boolean;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity
      style={[styles.folderRow, { borderTopColor: T.border }]}
      onPress={onPress}
      disabled={disabled}
      activeOpacity={0.7}
    >
      <View style={{ flex: 1 }}>
        <Text style={[styles.dmName, { color: T.textBright }]} numberOfLines={1}>
          {label}
        </Text>
        {sublabel ? <Text style={[styles.dmEmail, { color: T.textDim }]}>{sublabel}</Text> : null}
      </View>
      {selected ? <Check size={16} color={T.accent} weight="bold" /> : null}
    </TouchableOpacity>
  );
}

/** Always starts a fresh chat; several chats with the same agent is supported. */
function NewAgentChatModal({
  visible,
  T,
  pendingId,
  onClose,
  onPick,
}: {
  visible: boolean;
  T: ThemeColors;
  pendingId: string | null;
  onClose: () => void;
  onPick: (agentId: string) => void;
}) {
  const agentsQuery = useAgents();
  const [search, setSearch] = useState("");
  const agents = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (agentsQuery.data ?? [])
      .filter((a: SerializedAgent) => !q || a.name.toLowerCase().includes(q))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [agentsQuery.data, search]);

  return (
    <BottomSheet visible={visible} onClose={onClose} style={[styles.sheet, styles.dmSheet]}>
      <View style={styles.sheetHeader}>
        <Text style={[styles.sheetTitle, { color: T.textBright }]}>New agent chat</Text>
        <TouchableOpacity onPress={onClose} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <X size={18} color={T.textDim} weight="bold" />
        </TouchableOpacity>
      </View>
      <View style={[styles.searchBox, { backgroundColor: T.bg, borderColor: T.border }]}>
        <MagnifyingGlass size={16} color={T.textDim} weight="bold" />
        <TextInput
          value={search}
          onChangeText={setSearch}
          placeholder="Search agents"
          placeholderTextColor={T.textDim}
          style={[styles.searchInput, { color: T.textBright }]}
        />
      </View>
      <FlatList
        data={agents}
        keyExtractor={(item) => item.id}
        keyboardShouldPersistTaps="handled"
        style={styles.dmList}
        renderItem={({ item }) => (
          <TouchableOpacity
            style={[styles.dmRow, { borderBottomColor: T.border }]}
            onPress={() => onPick(item.id)}
            disabled={pendingId !== null}
            activeOpacity={0.7}
          >
            <View style={[styles.agentIcon, { backgroundColor: T.accentSoft }]}>
              {item.avatarEmoji ? (
                <Text style={styles.agentEmoji}>{item.avatarEmoji}</Text>
              ) : (
                <Robot size={18} color={T.accent} weight="fill" />
              )}
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.dmName, { color: T.textBright }]} numberOfLines={1}>
                {item.name}
              </Text>
              {item.description ? (
                <Text style={[styles.dmEmail, { color: T.textDim }]} numberOfLines={1}>
                  {item.description}
                </Text>
              ) : null}
            </View>
            {pendingId === item.id ? <ActivityIndicator size="small" color={T.accent} /> : null}
          </TouchableOpacity>
        )}
        ListEmptyComponent={
          <View style={styles.sectionEmpty}>
            <Text style={[styles.sectionEmptyText, { color: T.textDim }]}>
              {agentsQuery.isLoading ? "Loading..." : "No agents available"}
            </Text>
          </View>
        }
      />
    </BottomSheet>
  );
}

function NewDmModal({
  visible,
  T,
  pending,
  onClose,
  onCreate,
}: {
  visible: boolean;
  T: ThemeColors;
  pending: boolean;
  onClose: () => void;
  onCreate: (userIds: string[]) => void;
}) {
  const directory = useDirectory();
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const users = useMemo(() => {
    const q = search.trim().toLowerCase();
    return directory.subjects
      .filter((s) => s.kind === "USER")
      .filter(
        (s) => !q || s.name.toLowerCase().includes(q) || (s.email ?? "").toLowerCase().includes(q),
      );
  }, [directory.subjects, search]);

  const toggleUser = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <BottomSheet visible={visible} onClose={onClose} style={[styles.sheet, styles.dmSheet]}>
      <View style={styles.sheetHeader}>
        <Text style={[styles.sheetTitle, { color: T.textBright }]}>New direct message</Text>
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
      <FlatList
        data={users}
        keyExtractor={(item) => item.id}
        keyboardShouldPersistTaps="handled"
        style={styles.dmList}
        renderItem={({ item }) => {
          const active = selected.has(item.id);
          return (
            <TouchableOpacity
              style={[styles.dmRow, { borderBottomColor: T.border }]}
              onPress={() => toggleUser(item.id)}
              activeOpacity={0.7}
            >
              <Avatar name={item.name} avatarUrl={item.avatarUrl} size={36} />
              <View style={{ flex: 1 }}>
                <Text style={[styles.dmName, { color: T.textBright }]} numberOfLines={1}>
                  {item.name}
                </Text>
                {item.email ? (
                  <Text style={[styles.dmEmail, { color: T.textDim }]} numberOfLines={1}>
                    {item.email}
                  </Text>
                ) : null}
              </View>
              <View
                style={[
                  styles.dmCheckbox,
                  active
                    ? { backgroundColor: T.accent, borderColor: T.accent }
                    : { borderColor: T.border },
                ]}
              >
                {active ? <Check size={12} color="#fff" weight="bold" /> : null}
              </View>
            </TouchableOpacity>
          );
        }}
        ListEmptyComponent={
          <View style={styles.sectionEmpty}>
            <Text style={[styles.sectionEmptyText, { color: T.textDim }]}>
              {directory.isLoading ? "Loading..." : "No people found"}
            </Text>
          </View>
        }
      />
      <TouchableOpacity
        style={[
          styles.modalCta,
          { backgroundColor: selected.size > 0 ? T.accent : T.surfaceHover },
        ]}
        disabled={selected.size === 0 || pending}
        onPress={() => {
          onCreate([...selected]);
          setSelected(new Set());
          setSearch("");
        }}
        activeOpacity={0.8}
      >
        <Text style={[styles.modalCtaText, { color: selected.size > 0 ? "#fff" : T.textDim }]}>
          {pending
            ? "Starting..."
            : selected.size > 1
              ? `Start group chat (${selected.size})`
              : "Start chat"}
        </Text>
      </TouchableOpacity>
    </BottomSheet>
  );
}

function CategorySection({
  label,
  count,
  collapsed,
  onToggle,
  onLongPress,
  onAdd,
  onAddFolder,
  hasContent,
  T,
  children,
}: {
  label: string;
  count: number;
  collapsed: boolean;
  onToggle: () => void;
  onLongPress?: () => void;
  onAdd?: () => void;
  onAddFolder?: () => void;
  /** Overrides the count-based check when the body holds more than the counted rows. */
  hasContent?: boolean;
  T: ThemeColors;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.section}>
      <View style={styles.sectionHeaderRow}>
        <TouchableOpacity
          style={styles.sectionHeader}
          onPress={onToggle}
          onLongPress={onLongPress}
          delayLongPress={300}
          activeOpacity={0.6}
        >
          {collapsed ? (
            <CaretRight size={13} color={T.textDim} weight="bold" />
          ) : (
            <CaretDown size={13} color={T.textDim} weight="bold" />
          )}
          <Text style={[styles.sectionLabel, { color: T.textDim }]} numberOfLines={1}>
            {label}
          </Text>
          <Text style={[styles.sectionCount, { color: T.textDim }]}>{count}</Text>
        </TouchableOpacity>
        <View style={styles.sectionActions}>
          {onAddFolder ? (
            <TouchableOpacity
              onPress={onAddFolder}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              accessibilityLabel="New folder"
            >
              <FolderPlus size={16} color={T.textDim} weight="bold" />
            </TouchableOpacity>
          ) : null}
          {onAdd ? (
            <TouchableOpacity onPress={onAdd} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Plus size={15} color={T.textDim} weight="bold" />
            </TouchableOpacity>
          ) : null}
        </View>
      </View>
      {!collapsed ? (
        (hasContent ?? count > 0) ? (
          children
        ) : (
          <Text style={[styles.sectionEmptyInline, { color: T.textDim }]}>Nothing here yet</Text>
        )
      ) : null}
    </View>
  );
}

/** A folder nests inside its section, so it indents rather than reading as a peer. */
function FolderGroup({
  T,
  folder,
  count,
  collapsed,
  onToggle,
  onLongPress,
  children,
}: {
  T: ThemeColors;
  folder: SerializedAgentFolder;
  count: number;
  collapsed: boolean;
  onToggle: () => void;
  onLongPress: () => void;
  children: React.ReactNode;
}) {
  return (
    <View>
      <TouchableOpacity
        style={styles.folderHeader}
        onPress={onToggle}
        onLongPress={onLongPress}
        delayLongPress={300}
        activeOpacity={0.6}
      >
        {collapsed ? (
          <CaretRight size={12} color={T.textDim} weight="bold" />
        ) : (
          <CaretDown size={12} color={T.textDim} weight="bold" />
        )}
        <FolderSimple size={15} color={T.accent} weight="duotone" />
        <Text style={[styles.folderLabel, { color: T.text }]} numberOfLines={1}>
          {folder.name}
        </Text>
        <Text style={[styles.sectionCount, { color: T.textDim }]}>{count}</Text>
      </TouchableOpacity>
      {!collapsed && count > 0 ? (
        <View style={[styles.folderChildren, { borderLeftColor: T.border }]}>{children}</View>
      ) : null}
    </View>
  );
}

function ThreadsList({
  threads,
  loading,
  T,
  bottomPad,
  onOpen,
}: {
  threads: SerializedThreadInboxItem[];
  loading: boolean;
  T: ThemeColors;
  bottomPad: number;
  onOpen: (item: SerializedThreadInboxItem) => void;
}) {
  if (loading) {
    return (
      <View style={styles.loadingWrap}>
        <ActivityIndicator size="large" color={T.accent} />
      </View>
    );
  }
  return (
    <FlatList
      data={threads}
      keyExtractor={(item) => item.rootMessageId}
      showsVerticalScrollIndicator={false}
      contentContainerStyle={[
        threads.length === 0 ? styles.emptyContent : styles.listContent,
        { paddingBottom: bottomPad },
      ]}
      renderItem={({ item }) => (
        <TouchableOpacity
          style={[styles.row, { borderBottomColor: T.border }]}
          onPress={() => onOpen(item)}
          activeOpacity={0.7}
        >
          <View style={[styles.rowIcon, { backgroundColor: T.accentSoft }]}>
            <ChatText size={16} color={T.accent} weight="fill" />
          </View>
          <View style={styles.rowBody}>
            <Text
              style={[
                styles.rowTitle,
                { color: T.textBright, fontFamily: item.hasUnread ? FONT.bold : FONT.semibold },
              ]}
              numberOfLines={1}
            >
              {item.rootSenderName} in #{item.channelName}
            </Text>
            <Text style={[styles.rowSub, { color: T.textDim }]} numberOfLines={1}>
              {item.latestReplyPreview ?? item.rootPreview}
            </Text>
          </View>
          <View style={styles.rowRight}>
            <Text style={[styles.rowTime, { color: item.hasUnread ? T.accent : T.textDim }]}>
              {item.activityLabel}
            </Text>
            <Text style={[styles.rowReplies, { color: T.textDim }]}>
              {item.replyCount} {item.replyCount === 1 ? "reply" : "replies"}
            </Text>
          </View>
        </TouchableOpacity>
      )}
      ListEmptyComponent={
        <View style={styles.sectionEmpty}>
          <ChatText size={32} color={T.accent} weight="duotone" />
          <Text style={[styles.sectionEmptyText, { color: T.textDim }]}>No threads yet</Text>
        </View>
      }
    />
  );
}

function ChannelRow({
  channel,
  T,
  onPress,
  onLongPress,
  presence,
  peer,
}: {
  channel: SerializedChannel;
  T: ThemeColors;
  onPress: () => void;
  onLongPress?: () => void;
  presence?: string | null;
  peer?: { name: string; avatarUrl?: string } | null;
}) {
  const hasUnread = channel.unreadCount > 0;
  const liveCall = useActiveCall(channel.id);
  return (
    <TouchableOpacity
      style={[styles.row, { borderBottomColor: T.border }]}
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={300}
      activeOpacity={0.7}
    >
      <View style={[styles.rowIcon, { backgroundColor: peer ? "transparent" : T.accentSoft }]}>
        {peer ? (
          <Avatar name={peer.name} avatarUrl={peer.avatarUrl} size={40} />
        ) : (
          <ChannelIcon channel={channel} color={T.accent} />
        )}
        {presence ? <PresenceDot status={presence} size={12} ringColor={T.pageBg} /> : null}
      </View>
      <View style={styles.rowBody}>
        <Text
          style={[
            styles.rowTitle,
            { color: T.textBright, fontFamily: hasUnread ? FONT.bold : FONT.semibold },
          ]}
          numberOfLines={1}
        >
          {peer ? peer.name : channel.displayName}
        </Text>
        <Text style={[styles.rowSub, { color: T.textDim }]} numberOfLines={1}>
          {channel.description
            ? channel.description
            : `${channel.memberCount} ${channel.memberCount === 1 ? "member" : "members"}`}
        </Text>
      </View>
      <View style={styles.rowRight}>
        {liveCall ? (
          <View style={[styles.liveCallPill, { backgroundColor: T.green }]}>
            <Phone size={10} color="#ffffff" weight="fill" />
            <Text style={styles.liveCallPillText}>{liveCall.participants.length}</Text>
          </View>
        ) : null}
        {channel.lastMessageAtSeconds ? (
          <Text style={[styles.rowTime, { color: hasUnread ? T.accent : T.textDim }]}>
            {formatChannelActivity(channel.lastMessageAtSeconds)}
          </Text>
        ) : null}
        {channel.hasDraft || hasUnread ? (
          <View style={styles.rowIndicators}>
            {channel.hasDraft ? <PencilSimple size={13} color={T.textDim} weight="bold" /> : null}
            {hasUnread ? (
              <View
                style={[
                  styles.badge,
                  { backgroundColor: channel.mentionCount > 0 ? T.red : T.accent },
                ]}
              >
                <Text style={styles.badgeText}>
                  {channel.unreadCount > 99 ? "99+" : channel.unreadCount}
                </Text>
              </View>
            ) : null}
          </View>
        ) : null}
      </View>
    </TouchableOpacity>
  );
}

function BrowseRow({
  channel,
  T,
  joining,
  onJoin,
  onPress,
}: {
  channel: SerializedChannel;
  T: ThemeColors;
  joining: boolean;
  onJoin: () => void;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity
      style={[styles.row, { borderBottomColor: T.border }]}
      onPress={onPress}
      activeOpacity={0.7}
    >
      <View style={[styles.rowIcon, { backgroundColor: T.accentSoft }]}>
        <ChannelIcon channel={channel} color={T.accent} />
      </View>
      <View style={styles.rowBody}>
        <Text style={[styles.rowTitle, { color: T.textBright }]} numberOfLines={1}>
          {channel.displayName}
        </Text>
        <Text style={[styles.rowSub, { color: T.textDim }]} numberOfLines={1}>
          {channel.memberCount} {channel.memberCount === 1 ? "member" : "members"}
        </Text>
      </View>
      <TouchableOpacity
        style={[styles.joinBtn, { backgroundColor: T.accent }]}
        onPress={onJoin}
        disabled={joining}
        activeOpacity={0.8}
      >
        <Text style={styles.joinBtnText}>Join</Text>
      </TouchableOpacity>
    </TouchableOpacity>
  );
}

function EmptyChannels({ T }: { T: ThemeColors }) {
  return (
    <View style={styles.emptyState}>
      <View style={[styles.emptyIconWrap, { backgroundColor: T.accentSoft }]}>
        <ChatTeardropText size={36} color={T.accent} weight="duotone" />
      </View>
      <Text style={[styles.emptyTitle, { color: T.textBright }]}>No channels yet</Text>
      <Text style={[styles.emptySubtitle, { color: T.textDim }]}>
        Create a channel or browse public ones to start chatting
      </Text>
      <TouchableOpacity
        style={[styles.emptyCta, { backgroundColor: T.accent }]}
        onPress={() => router.push("/chat/create" as any)}
        activeOpacity={0.8}
      >
        <Text style={styles.emptyCtaText}>Create channel</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  filterBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  filterPill: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  filterPillText: { fontSize: 13, fontFamily: FONT.medium },
  browseBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  browseTitle: { fontSize: 15, fontFamily: FONT.semibold },
  browseClose: { fontSize: 14, fontFamily: FONT.semibold },
  listContent: { paddingBottom: 24 },
  emptyContent: { flexGrow: 1 },
  section: { paddingTop: 6 },
  sectionHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  sectionHeader: { flexDirection: "row", alignItems: "center", gap: 6, flex: 1 },
  sectionActions: { flexDirection: "row", alignItems: "center", gap: 14 },
  folderHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    paddingLeft: 24,
    paddingRight: 16,
    paddingVertical: 9,
  },
  folderLabel: { fontSize: 13, fontFamily: FONT.semibold, flex: 1 },
  folderChildren: { marginLeft: 30, borderLeftWidth: StyleSheet.hairlineWidth },
  sectionLabel: {
    fontSize: 12,
    fontFamily: FONT.bold,
    letterSpacing: 0.5,
    textTransform: "uppercase",
  },
  sectionCount: { fontSize: 12, fontFamily: FONT.medium },
  sectionEmptyInline: {
    fontSize: 13,
    fontFamily: FONT.regular,
    paddingHorizontal: 38,
    paddingBottom: 8,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 13,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rowIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  rowBody: { flex: 1, gap: 2 },
  rowTitle: { fontSize: 15 },
  rowSub: { fontSize: 12, fontFamily: FONT.regular },
  rowRight: { alignItems: "flex-end", gap: 5, flexShrink: 0 },
  rowIndicators: { flexDirection: "row", alignItems: "center", gap: 5 },
  rowTime: { fontSize: 11, fontFamily: FONT.medium },
  rowReplies: { fontSize: 11, fontFamily: FONT.regular },
  badge: {
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    paddingHorizontal: 6,
    alignItems: "center",
    justifyContent: "center",
  },
  badgeText: { color: "#fff", fontSize: 11, fontFamily: FONT.bold },
  liveCallPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    borderRadius: 9,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  liveCallPillText: { color: "#fff", fontSize: 10, fontFamily: FONT.bold },
  joinBtn: { paddingHorizontal: 16, paddingVertical: 7, borderRadius: 8 },
  joinBtnText: { color: "#fff", fontSize: 13, fontFamily: FONT.semibold },
  sectionEmpty: { paddingTop: 40, alignItems: "center", gap: 10 },
  sectionEmptyText: { fontSize: 14, fontFamily: FONT.regular },
  loadingWrap: { flex: 1, alignItems: "center", justifyContent: "center", paddingTop: 60 },
  emptyState: { alignItems: "center", paddingTop: 60, gap: 12, paddingHorizontal: 40 },
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
  sheet: { paddingHorizontal: 16 },
  dmSheet: { height: "75%", maxHeight: "75%" },
  sheetHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    paddingBottom: 14,
  },
  sheetTitle: { fontSize: 16, fontFamily: FONT.semibold, flex: 1 },
  modalInput: {
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    fontFamily: FONT.regular,
  },
  modalCta: {
    marginTop: 14,
    paddingVertical: 13,
    borderRadius: 12,
    alignItems: "center",
  },
  modalCtaText: { fontSize: 15, fontFamily: FONT.semibold },
  searchBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  searchInput: { flex: 1, fontSize: 15, fontFamily: FONT.regular, padding: 0 },
  dmList: { marginTop: 8 },
  dmRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 11,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  agentIcon: {
    width: 36,
    height: 36,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
  },
  agentEmoji: { fontSize: 18 },
  folderRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  newFolderRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 14 },
  newFolderText: { fontSize: 14, fontFamily: FONT.medium },
  dmName: { fontSize: 15, fontFamily: FONT.medium },
  dmEmail: { fontSize: 12, fontFamily: FONT.regular, marginTop: 1 },
  dmCheckbox: {
    width: 20,
    height: 20,
    borderRadius: 6,
    borderWidth: 1.5,
    alignItems: "center",
    justifyContent: "center",
  },
});
