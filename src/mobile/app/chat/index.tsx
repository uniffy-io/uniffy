import React, { useState, useCallback, useMemo } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  FlatList,
  ScrollView,
  ActivityIndicator,
  RefreshControl,
  Modal,
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
  X,
  MagnifyingGlass,
} from "phosphor-react-native";
import { router } from "expo-router";
import { DomainHeader } from "@/components/DomainHeader";
import { Avatar } from "@/components/Avatar";
import { useTheme } from "@/hooks/useTheme";
import type { ThemeColors } from "@/constants/theme";
import { DOMAIN_COLORS } from "@/constants/theme";
import {
  useChannels,
  useAgentChats,
  useThreadsInbox,
  useBrowseChannels,
  useCategories,
} from "@/hooks/useChat";
import { useJoinChannel, useCreateCategory, useCreateDm } from "@/hooks/useChatMutations";
import { useDirectory } from "@/hooks/usePermissions";
import {
  formatChannelActivity,
  type SerializedChannel,
  type SerializedThreadInboxItem,
} from "@/lib/chatSerializer";

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

export default function ChatListScreen() {
  const T = useTheme();
  const [tab, setTab] = useState<Tab>("all");
  const [browsing, setBrowsing] = useState(false);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const [newCategoryOpen, setNewCategoryOpen] = useState(false);
  const [newDmOpen, setNewDmOpen] = useState(false);

  const { channels, isLoading, isFetching, refetch } = useChannels();
  const { agentChats: agentChatList } = useAgentChats();
  const categories = useCategories();
  const threads = useThreadsInbox(tab === "threads");
  const browse = useBrowseChannels(browsing);
  const joinChannel = useJoinChannel();
  const createCategory = useCreateCategory();
  const createDm = useCreateDm();

  const openChannel = useCallback((id: string) => router.push(`/chat/${id}` as any), []);

  // Agent chats arrive via both ListChannels (is_agent_dm) and ListAgentChats; merge + dedupe.
  const agentChats = useMemo(() => {
    const byId = new Map<string, SerializedChannel>();
    for (const c of channels) if (c.isAgentDm) byId.set(c.id, c);
    for (const c of agentChatList) if (!byId.has(c.id)) byId.set(c.id, c);
    return [...byId.values()].sort((a, b) => b.lastMessageAtSeconds - a.lastMessageAtSeconds);
  }, [channels, agentChatList]);

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

  const categorized = useMemo(() => {
    const cats = categories.data ?? [];
    return cats.map((cat) => ({
      category: cat,
      channels: channels.filter(
        (c) => !c.isAgentDm && c.categoryId === cat.id && c.channelType !== "DIRECT" && c.channelType !== "GROUP_DM",
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
      color={DOMAIN_COLORS.chat}
      icon="chat"
      rightActions={
        <>
          <TouchableOpacity
            onPress={() => setBrowsing((v) => !v)}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Compass size={21} color={browsing ? DOMAIN_COLORS.chat : T.text} weight="duotone" />
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => setNewCategoryOpen(true)}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Plus size={21} color={DOMAIN_COLORS.chat} weight="bold" />
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
            <Text style={[styles.browseClose, { color: DOMAIN_COLORS.chat }]}>Done</Text>
          </TouchableOpacity>
        </View>
        {browse.isLoading ? (
          <View style={styles.loadingWrap}>
            <ActivityIndicator size="large" color={DOMAIN_COLORS.chat} />
          </View>
        ) : (
          <FlatList
            data={browseList}
            keyExtractor={(item) => item.id}
            showsVerticalScrollIndicator={false}
            contentContainerStyle={browseList.length === 0 ? styles.emptyContent : styles.listContent}
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
                  ? { backgroundColor: DOMAIN_COLORS.chat }
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
        <ThreadsList threads={threads.data ?? []} loading={threads.isLoading} T={T} onOpen={openChannel} />
      ) : tab === "unreads" ? (
        <FlatList
          data={unreadList}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <ChannelRow channel={item} T={T} onPress={() => openChannel(item.id)} />
          )}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={unreadList.length === 0 ? styles.emptyContent : styles.listContent}
          ListEmptyComponent={
            <View style={styles.sectionEmpty}>
              <Text style={[styles.sectionEmptyText, { color: T.textDim }]}>You are all caught up</Text>
            </View>
          }
        />
      ) : isLoading && channels.length === 0 ? (
        <View style={styles.loadingWrap}>
          <ActivityIndicator size="large" color={DOMAIN_COLORS.chat} />
        </View>
      ) : channels.length === 0 && agentChats.length === 0 ? (
        <EmptyChannels T={T} />
      ) : (
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.listContent}
          refreshControl={
            <RefreshControl
              refreshing={isFetching && !isLoading}
              onRefresh={() => refetch()}
              tintColor={DOMAIN_COLORS.chat}
              colors={[DOMAIN_COLORS.chat]}
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
            T={T}
            onAdd={() => router.push("/agents" as any)}
          >
            {agentChats.map((c) => (
              <ChannelRow key={c.id} channel={c} T={T} onPress={() => openChannel(c.id)} />
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
              <ChannelRow key={c.id} channel={c} T={T} onPress={() => openChannel(c.id)} />
            ))}
          </CategorySection>
        </ScrollView>
      )}

      <NewCategoryModal
        visible={newCategoryOpen}
        T={T}
        pending={createCategory.isPending}
        onClose={() => setNewCategoryOpen(false)}
        onCreate={(name) =>
          createCategory.mutate(name, { onSuccess: () => setNewCategoryOpen(false) })
        }
      />

      <NewDmModal
        visible={newDmOpen}
        T={T}
        pending={createDm.isPending}
        onClose={() => setNewDmOpen(false)}
        onPick={(userId) =>
          createDm.mutate([userId], {
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

function NewCategoryModal({
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
  onCreate: (name: string) => void;
}) {
  const [name, setName] = useState("");
  const trimmed = name.trim();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={onClose} />
      <View style={[styles.sheet, { backgroundColor: T.surface }]}>
        <View style={[styles.handle, { backgroundColor: T.border }]} />
        <View style={styles.sheetHeader}>
          <FolderPlus size={20} color={DOMAIN_COLORS.chat} weight="duotone" />
          <Text style={[styles.sheetTitle, { color: T.textBright }]}>New category</Text>
        </View>
        <TextInput
          value={name}
          onChangeText={setName}
          placeholder="Category name"
          placeholderTextColor={T.textDim}
          autoFocus
          style={[styles.modalInput, { color: T.textBright, backgroundColor: T.bg, borderColor: T.border }]}
        />
        <TouchableOpacity
          style={[styles.modalCta, { backgroundColor: trimmed ? DOMAIN_COLORS.chat : T.surfaceHover }]}
          disabled={!trimmed || pending}
          onPress={() => {
            onCreate(trimmed);
            setName("");
          }}
          activeOpacity={0.8}
        >
          <Text style={[styles.modalCtaText, { color: trimmed ? "#fff" : T.textDim }]}>
            {pending ? "Creating..." : "Create category"}
          </Text>
        </TouchableOpacity>
      </View>
    </Modal>
  );
}

function NewDmModal({
  visible,
  T,
  pending,
  onClose,
  onPick,
}: {
  visible: boolean;
  T: ThemeColors;
  pending: boolean;
  onClose: () => void;
  onPick: (userId: string) => void;
}) {
  const directory = useDirectory();
  const [search, setSearch] = useState("");
  const users = useMemo(() => {
    const q = search.trim().toLowerCase();
    return directory.subjects
      .filter((s) => s.kind === "USER")
      .filter((s) => !q || s.name.toLowerCase().includes(q) || (s.email ?? "").toLowerCase().includes(q));
  }, [directory.subjects, search]);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={onClose} />
      <View style={[styles.sheet, styles.dmSheet, { backgroundColor: T.surface }]}>
        <View style={[styles.handle, { backgroundColor: T.border }]} />
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
          renderItem={({ item }) => (
            <TouchableOpacity
              style={[styles.dmRow, { borderBottomColor: T.border }]}
              onPress={() => !pending && onPick(item.id)}
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
            </TouchableOpacity>
          )}
          ListEmptyComponent={
            <View style={styles.sectionEmpty}>
              <Text style={[styles.sectionEmptyText, { color: T.textDim }]}>
                {directory.isLoading ? "Loading..." : "No people found"}
              </Text>
            </View>
          }
        />
      </View>
    </Modal>
  );
}

function CategorySection({
  label,
  count,
  collapsed,
  onToggle,
  onAdd,
  T,
  children,
}: {
  label: string;
  count: number;
  collapsed: boolean;
  onToggle: () => void;
  onAdd?: () => void;
  T: ThemeColors;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.section}>
      <View style={styles.sectionHeaderRow}>
        <TouchableOpacity style={styles.sectionHeader} onPress={onToggle} activeOpacity={0.6}>
          {collapsed ? (
            <CaretRight size={13} color={T.textDim} weight="bold" />
          ) : (
            <CaretDown size={13} color={T.textDim} weight="bold" />
          )}
          <Text style={[styles.sectionLabel, { color: T.textDim }]}>{label}</Text>
          <Text style={[styles.sectionCount, { color: T.textDim }]}>{count}</Text>
        </TouchableOpacity>
        {onAdd ? (
          <TouchableOpacity onPress={onAdd} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Plus size={15} color={T.textDim} weight="bold" />
          </TouchableOpacity>
        ) : null}
      </View>
      {!collapsed ? (
        count === 0 ? (
          <Text style={[styles.sectionEmptyInline, { color: T.textDim }]}>Nothing here yet</Text>
        ) : (
          children
        )
      ) : null}
    </View>
  );
}

function ThreadsList({
  threads,
  loading,
  T,
  onOpen,
}: {
  threads: SerializedThreadInboxItem[];
  loading: boolean;
  T: ThemeColors;
  onOpen: (channelId: string) => void;
}) {
  if (loading) {
    return (
      <View style={styles.loadingWrap}>
        <ActivityIndicator size="large" color={DOMAIN_COLORS.chat} />
      </View>
    );
  }
  return (
    <FlatList
      data={threads}
      keyExtractor={(item) => item.rootMessageId}
      showsVerticalScrollIndicator={false}
      contentContainerStyle={threads.length === 0 ? styles.emptyContent : styles.listContent}
      renderItem={({ item }) => (
        <TouchableOpacity
          style={[styles.row, { borderBottomColor: T.border }]}
          onPress={() => onOpen(item.channelId)}
          activeOpacity={0.7}
        >
          <View style={[styles.rowIcon, { backgroundColor: DOMAIN_COLORS.chatSoft }]}>
            <ChatText size={16} color={DOMAIN_COLORS.chat} weight="fill" />
          </View>
          <View style={styles.rowBody}>
            <Text
              style={[
                styles.rowTitle,
                { color: T.textBright, fontFamily: item.hasUnread ? "Inter_700Bold" : "Inter_600SemiBold" },
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
            <Text style={[styles.rowTime, { color: item.hasUnread ? DOMAIN_COLORS.chat : T.textDim }]}>
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
          <ChatText size={32} color={DOMAIN_COLORS.chat} weight="duotone" />
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
}: {
  channel: SerializedChannel;
  T: ThemeColors;
  onPress: () => void;
}) {
  const hasUnread = channel.unreadCount > 0;
  return (
    <TouchableOpacity
      style={[styles.row, { borderBottomColor: T.border }]}
      onPress={onPress}
      activeOpacity={0.7}
    >
      <View style={[styles.rowIcon, { backgroundColor: DOMAIN_COLORS.chatSoft }]}>
        <ChannelIcon channel={channel} color={DOMAIN_COLORS.chat} />
      </View>
      <View style={styles.rowBody}>
        <Text
          style={[
            styles.rowTitle,
            { color: T.textBright, fontFamily: hasUnread ? "Inter_700Bold" : "Inter_600SemiBold" },
          ]}
          numberOfLines={1}
        >
          {channel.displayName}
        </Text>
        <Text style={[styles.rowSub, { color: T.textDim }]} numberOfLines={1}>
          {channel.description
            ? channel.description
            : `${channel.memberCount} ${channel.memberCount === 1 ? "member" : "members"}`}
        </Text>
      </View>
      <View style={styles.rowRight}>
        {channel.lastMessageAtSeconds ? (
          <Text style={[styles.rowTime, { color: hasUnread ? DOMAIN_COLORS.chat : T.textDim }]}>
            {formatChannelActivity(channel.lastMessageAtSeconds)}
          </Text>
        ) : null}
        {hasUnread ? (
          <View
            style={[
              styles.badge,
              { backgroundColor: channel.mentionCount > 0 ? T.red : DOMAIN_COLORS.chat },
            ]}
          >
            <Text style={styles.badgeText}>{channel.unreadCount > 99 ? "99+" : channel.unreadCount}</Text>
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
      <View style={[styles.rowIcon, { backgroundColor: DOMAIN_COLORS.chatSoft }]}>
        <ChannelIcon channel={channel} color={DOMAIN_COLORS.chat} />
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
        style={[styles.joinBtn, { backgroundColor: DOMAIN_COLORS.chat }]}
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
      <View style={[styles.emptyIconWrap, { backgroundColor: DOMAIN_COLORS.chatSoft }]}>
        <ChatTeardropText size={36} color={DOMAIN_COLORS.chat} weight="duotone" />
      </View>
      <Text style={[styles.emptyTitle, { color: T.textBright }]}>No channels yet</Text>
      <Text style={[styles.emptySubtitle, { color: T.textDim }]}>
        Create a channel or browse public ones to start chatting
      </Text>
      <TouchableOpacity
        style={[styles.emptyCta, { backgroundColor: DOMAIN_COLORS.chat }]}
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
  filterPillText: { fontSize: 13, fontFamily: "Inter_500Medium" },
  browseBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  browseTitle: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  browseClose: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
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
  sectionLabel: { fontSize: 12, fontFamily: "Inter_700Bold", letterSpacing: 0.5, textTransform: "uppercase" },
  sectionCount: { fontSize: 12, fontFamily: "Inter_500Medium" },
  sectionEmptyInline: { fontSize: 13, fontFamily: "Inter_400Regular", paddingHorizontal: 38, paddingBottom: 8 },
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
  rowSub: { fontSize: 12, fontFamily: "Inter_400Regular" },
  rowRight: { alignItems: "flex-end", gap: 5, flexShrink: 0 },
  rowTime: { fontSize: 11, fontFamily: "Inter_500Medium" },
  rowReplies: { fontSize: 11, fontFamily: "Inter_400Regular" },
  badge: {
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    paddingHorizontal: 6,
    alignItems: "center",
    justifyContent: "center",
  },
  badgeText: { color: "#fff", fontSize: 11, fontFamily: "Inter_700Bold" },
  joinBtn: { paddingHorizontal: 16, paddingVertical: 7, borderRadius: 8 },
  joinBtnText: { color: "#fff", fontSize: 13, fontFamily: "Inter_600SemiBold" },
  sectionEmpty: { paddingTop: 40, alignItems: "center", gap: 10 },
  sectionEmptyText: { fontSize: 14, fontFamily: "Inter_400Regular" },
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
  emptyTitle: { fontSize: 17, fontFamily: "Inter_600SemiBold" },
  emptySubtitle: { fontSize: 14, fontFamily: "Inter_400Regular", textAlign: "center" },
  emptyCta: { marginTop: 8, paddingHorizontal: 24, paddingVertical: 11, borderRadius: 10 },
  emptyCtaText: { fontSize: 14, fontFamily: "Inter_600SemiBold", color: "#fff" },
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)" },
  sheet: { borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingBottom: 32, paddingHorizontal: 16 },
  dmSheet: { height: "75%" },
  handle: { width: 36, height: 4, borderRadius: 2, alignSelf: "center", marginTop: 8, marginBottom: 12 },
  sheetHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    paddingBottom: 14,
  },
  sheetTitle: { fontSize: 16, fontFamily: "Inter_600SemiBold", flex: 1 },
  modalInput: {
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    fontFamily: "Inter_400Regular",
  },
  modalCta: {
    marginTop: 14,
    paddingVertical: 13,
    borderRadius: 12,
    alignItems: "center",
  },
  modalCtaText: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  searchBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  searchInput: { flex: 1, fontSize: 15, fontFamily: "Inter_400Regular", padding: 0 },
  dmList: { marginTop: 8 },
  dmRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 11,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  dmName: { fontSize: 15, fontFamily: "Inter_500Medium" },
  dmEmail: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 1 },
});
