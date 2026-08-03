import React, { useMemo, useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
} from "react-native";
import { Hash, LockSimple, Check, Plus, X, MagnifyingGlass } from "phosphor-react-native";
import { BottomSheet } from "@shared/components/BottomSheet";
import { useTheme } from "@shared/hooks/useTheme";
import { FONT } from "@theme/typography";
import { useChannels } from "@features/chat/useChat";
import { useCreateChannel } from "@features/chat/useChatMutations";

interface MeetingChannelPickerProps {
  selectedChannelId: string | null;
  onSelect: (channelId: string | null) => void;
  /** Reports a channel the picker just created so the event can mark it auto-created. */
  onCreateRoom: (channelId: string) => void;
  /** Used to name a room created from the picker. */
  eventTitle: string;
  accentColor: string;
}

export function MeetingChannelPicker({
  selectedChannelId,
  onSelect,
  onCreateRoom,
  eventTitle,
  accentColor,
}: MeetingChannelPickerProps) {
  const T = useTheme();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const { channels, isLoading } = useChannels();
  const createChannel = useCreateChannel();

  // Agent DMs and archived rooms are never valid meeting targets.
  const bindable = useMemo(() => channels.filter((c) => !c.isAgentDm && !c.isArchived), [channels]);
  const selected = useMemo(
    () => (selectedChannelId ? (channels.find((c) => c.id === selectedChannelId) ?? null) : null),
    [channels, selectedChannelId],
  );
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return bindable;
    return bindable.filter((c) => (c.displayName || c.name).toLowerCase().includes(q));
  }, [bindable, query]);

  const handleCreateRoom = () => {
    if (createChannel.isPending) return;
    createChannel.mutate(
      { name: eventTitle.trim() || "Meeting", channelType: "PRIVATE" },
      {
        onSuccess: (res) => {
          const id = res.channel?.id;
          if (!id) return;
          onCreateRoom(id);
          setOpen(false);
          setQuery("");
        },
      },
    );
  };

  const handleSelect = (id: string) => {
    onSelect(id);
    setOpen(false);
    setQuery("");
  };

  return (
    <>
      {selected ? (
        <View style={[styles.selectedRow, { backgroundColor: T.pageBg, borderColor: T.border }]}>
          {selected.channelType === "PUBLIC" ? (
            <Hash size={16} color={T.textDim} weight="duotone" />
          ) : (
            <LockSimple size={16} color={T.textDim} weight="duotone" />
          )}
          <Text style={[styles.selectedName, { color: T.textBright }]} numberOfLines={1}>
            {selected.displayName || selected.name}
          </Text>
          <TouchableOpacity
            onPress={() => onSelect(null)}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <X size={15} color={T.textDim} weight="bold" />
          </TouchableOpacity>
        </View>
      ) : (
        <TouchableOpacity
          style={[styles.triggerRow, { backgroundColor: T.pageBg, borderColor: T.border }]}
          onPress={() => setOpen(true)}
          activeOpacity={0.7}
        >
          <Hash size={16} color={T.textDim} weight="duotone" />
          <Text style={[styles.triggerText, { color: T.textDim }]}>Select a channel</Text>
        </TouchableOpacity>
      )}

      <BottomSheet visible={open} onClose={() => setOpen(false)}>
        <View style={styles.headerRow}>
          <Text style={[styles.title, { color: T.textBright }]}>Uniffy meeting</Text>
        </View>

        <View style={[styles.searchBar, { backgroundColor: T.pageBg, borderColor: T.border }]}>
          <MagnifyingGlass size={15} color={T.textDim} weight="bold" />
          <TextInput
            style={[styles.searchInput, { color: T.textBright }]}
            value={query}
            onChangeText={setQuery}
            placeholder="Search channels"
            placeholderTextColor={T.textDim}
            autoCorrect={false}
            returnKeyType="done"
          />
          {query.length > 0 && (
            <TouchableOpacity
              onPress={() => setQuery("")}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <X size={15} color={T.textDim} weight="bold" />
            </TouchableOpacity>
          )}
        </View>

        <TouchableOpacity
          style={[styles.createRow, { borderBottomColor: T.border }]}
          onPress={handleCreateRoom}
          activeOpacity={0.7}
          disabled={createChannel.isPending}
        >
          <View style={[styles.dot, { backgroundColor: accentColor }]}>
            {createChannel.isPending ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <Plus size={12} color="#fff" weight="bold" />
            )}
          </View>
          <Text style={[styles.rowText, { color: T.textBright }]}>
            {createChannel.isPending ? "Creating room" : "Create a new meeting room"}
          </Text>
        </TouchableOpacity>

        <ScrollView style={{ maxHeight: 320 }} keyboardShouldPersistTaps="handled">
          {filtered.map((channel) => {
            const isSel = channel.id === selectedChannelId;
            return (
              <TouchableOpacity
                key={channel.id}
                style={[styles.row, { borderBottomColor: T.border }]}
                onPress={() => handleSelect(channel.id)}
                activeOpacity={0.7}
              >
                {channel.channelType === "PUBLIC" ? (
                  <Hash size={16} color={T.textDim} weight="duotone" />
                ) : (
                  <LockSimple size={16} color={T.textDim} weight="duotone" />
                )}
                <Text style={[styles.rowText, { color: T.textBright }]} numberOfLines={1}>
                  {channel.displayName || channel.name}
                </Text>
                {isSel && <Check size={18} color={accentColor} weight="bold" />}
              </TouchableOpacity>
            );
          })}
          {isLoading && (
            <View style={styles.loading}>
              <ActivityIndicator size="small" color={accentColor} />
            </View>
          )}
          {!isLoading && filtered.length === 0 && (
            <Text style={[styles.empty, { color: T.textDim }]}>No channels found</Text>
          )}
        </ScrollView>
      </BottomSheet>
    </>
  );
}

const styles = StyleSheet.create({
  triggerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 11,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
  },
  triggerText: { fontSize: 14, fontFamily: FONT.regular },
  selectedRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 11,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
  },
  selectedName: { flex: 1, fontSize: 14, fontFamily: FONT.medium },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  title: { fontSize: 16, fontFamily: FONT.bold },
  searchBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginHorizontal: 16,
    marginBottom: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
  },
  searchInput: { flex: 1, fontSize: 15, fontFamily: FONT.regular, padding: 0 },
  createRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 13,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 13,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  dot: { width: 18, height: 18, borderRadius: 9, alignItems: "center", justifyContent: "center" },
  rowText: { fontSize: 15, fontFamily: FONT.medium, flex: 1 },
  loading: { padding: 16, alignItems: "center" },
  empty: { padding: 16, textAlign: "center", fontSize: 14, fontFamily: FONT.regular },
});
