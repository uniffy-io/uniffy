import React, { useCallback } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  FlatList,
  ActivityIndicator,
  RefreshControl,
} from "react-native";
import { Image } from "expo-image";
import { Plus, Robot, Sparkle } from "phosphor-react-native";
import { router } from "expo-router";
import { DomainHeader } from "@shared/components/DomainHeader";
import { useTheme } from "@shared/hooks/useTheme";
import type { ThemeColors } from "@theme/theme";
import { FONT } from "@theme/typography";
import { getAccessToken } from "@core/auth/auth";
import { useAuth } from "@core/providers/auth-context";
import { useAgents, useStartAgentChat, useCreateAgentChat } from "@features/agents/useAgents";
import { agentAvatarUrl, type SerializedAgent } from "@features/agents/agentSerializer";

export default function AgentsListScreen() {
  const T = useTheme();
  const { organizationId } = useAuth();
  const agents = useAgents();
  const startChat = useStartAgentChat();
  const createChat = useCreateAgentChat();

  const open = useCallback(
    (agentId: string) => {
      startChat.mutate(agentId, {
        onSuccess: (channelId) => {
          if (channelId) router.push(`/chat/${channelId}` as any);
        },
      });
    },
    [startChat],
  );

  const openNew = useCallback(
    (agentId: string) => {
      createChat.mutate(agentId, {
        onSuccess: (channelId) => {
          if (channelId) router.push(`/chat/${channelId}` as any);
        },
      });
    },
    [createChat],
  );

  const pending = startChat.isPending || createChat.isPending;

  const renderItem = useCallback(
    ({ item }: { item: SerializedAgent }) => (
      <AgentRow
        agent={item}
        T={T}
        organizationId={organizationId ?? ""}
        starting={pending}
        onPress={() => open(item.id)}
        onNewChat={() => openNew(item.id)}
      />
    ),
    [T, organizationId, pending, open, openNew],
  );

  const data = agents.data ?? [];

  return (
    <View style={[styles.container, { backgroundColor: T.pageBg }]}>
      <DomainHeader title="Agents" color={T.domains.agents} icon="agents" />

      {agents.isLoading ? (
        <View style={styles.loadingWrap}>
          <ActivityIndicator size="large" color={T.domains.agents} />
        </View>
      ) : (
        <FlatList
          data={data}
          renderItem={renderItem}
          keyExtractor={(item) => item.id}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={data.length === 0 ? styles.emptyContent : styles.listContent}
          ListEmptyComponent={<EmptyAgents T={T} />}
          refreshControl={
            <RefreshControl
              refreshing={agents.isFetching && !agents.isLoading}
              onRefresh={() => agents.refetch()}
              tintColor={T.domains.agents}
              colors={[T.domains.agents]}
            />
          }
        />
      )}
    </View>
  );
}

function AgentRow({
  agent,
  T,
  organizationId,
  starting,
  onPress,
  onNewChat,
}: {
  agent: SerializedAgent;
  T: ThemeColors;
  organizationId: string;
  starting: boolean;
  onPress: () => void;
  onNewChat: () => void;
}) {
  const imageUri = agentAvatarUrl(organizationId, agent.id, agent.avatarKey);
  return (
    <TouchableOpacity
      style={[styles.row, { borderBottomColor: T.border }]}
      onPress={onPress}
      disabled={starting}
      activeOpacity={0.7}
    >
      <View style={[styles.avatar, { backgroundColor: agent.themeColor + "22" }]}>
        {imageUri ? (
          <Image
            source={{
              uri: imageUri,
              headers: { Authorization: `Bearer ${getAccessToken() ?? ""}` },
            }}
            style={styles.avatarImg}
            contentFit="cover"
          />
        ) : agent.avatarEmoji ? (
          <Text style={styles.avatarEmoji}>{agent.avatarEmoji}</Text>
        ) : (
          <Robot size={22} color={agent.themeColor} weight="fill" />
        )}
      </View>
      <View style={styles.body}>
        <View style={styles.titleRow}>
          <Text style={[styles.name, { color: T.textBright }]} numberOfLines={1}>
            {agent.name}
          </Text>
          {agent.isDefault ? (
            <View style={[styles.defaultTag, { backgroundColor: T.domains.agentsSoft }]}>
              <Text style={[styles.defaultTagText, { color: T.domains.agents }]}>DEFAULT</Text>
            </View>
          ) : null}
        </View>
        {agent.description ? (
          <Text style={[styles.desc, { color: T.textDim }]} numberOfLines={2}>
            {agent.description}
          </Text>
        ) : null}
      </View>
      <TouchableOpacity
        style={[styles.newChatBtn, { backgroundColor: T.domains.agentsSoft }]}
        onPress={onNewChat}
        disabled={starting}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        accessibilityRole="button"
        accessibilityLabel={`New chat with ${agent.name}`}
      >
        <Plus size={16} color={T.domains.agents} weight="bold" />
      </TouchableOpacity>
    </TouchableOpacity>
  );
}

function EmptyAgents({ T }: { T: ThemeColors }) {
  return (
    <View style={styles.emptyState}>
      <View style={[styles.emptyIconWrap, { backgroundColor: T.domains.agentsSoft }]}>
        <Sparkle size={36} color={T.domains.agents} weight="duotone" />
      </View>
      <Text style={[styles.emptyTitle, { color: T.textBright }]}>No agents yet</Text>
      <Text style={[styles.emptySubtitle, { color: T.textDim }]}>
        AI assistants created in the workspace will appear here
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  loadingWrap: { flex: 1, alignItems: "center", justifyContent: "center" },
  listContent: { paddingBottom: 24 },
  emptyContent: { flexGrow: 1 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 13,
    paddingHorizontal: 16,
    paddingVertical: 13,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  avatar: {
    width: 46,
    height: 46,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  avatarImg: { width: "100%", height: "100%" },
  avatarEmoji: { fontSize: 24 },
  body: { flex: 1, gap: 3 },
  titleRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  name: { fontSize: 15, fontFamily: FONT.semibold, flexShrink: 1 },
  defaultTag: { paddingHorizontal: 5, paddingVertical: 1, borderRadius: 4 },
  defaultTagText: { fontSize: 9, fontFamily: FONT.bold, letterSpacing: 0.4 },
  desc: { fontSize: 12, fontFamily: FONT.regular, lineHeight: 17 },
  newChatBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  emptyState: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    paddingHorizontal: 40,
  },
  emptyIconWrap: {
    width: 76,
    height: 76,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 4,
  },
  emptyTitle: { fontSize: 17, fontFamily: FONT.semibold },
  emptySubtitle: { fontSize: 14, fontFamily: FONT.regular, textAlign: "center", lineHeight: 20 },
});
