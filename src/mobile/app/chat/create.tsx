import React, { useState } from "react";
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  TextInput,
  StyleSheet,
  ActivityIndicator,
} from "react-native";
import { Hash, Lock } from "phosphor-react-native";
import { router } from "expo-router";
import { DomainHeader } from "@/components/DomainHeader";
import { useTheme } from "@/hooks/useTheme";
import { FONT } from "@/constants/typography";
import { useCreateChannel } from "@/hooks/useChatMutations";
import type { ChannelType } from "@/lib/chatSerializer";

const TYPES: { key: ChannelType; label: string; hint: string; Icon: typeof Hash }[] = [
  { key: "PUBLIC", label: "Public", hint: "Anyone in the org can find and join", Icon: Hash },
  { key: "PRIVATE", label: "Private", hint: "Only invited members can access", Icon: Lock },
];

export default function CreateChannelScreen() {
  const T = useTheme();
  const createChannel = useCreateChannel();

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [type, setType] = useState<ChannelType>("PUBLIC");

  const canSave = name.trim().length > 0 && !createChannel.isPending;

  const handleCreate = () => {
    if (!canSave) return;
    createChannel.mutate(
      { name: name.trim(), channelType: type, description: description.trim() || undefined },
      {
        onSuccess: (res) => {
          const channelId = res.channel?.id;
          if (channelId) {
            router.replace(`/chat/${channelId}` as any);
          } else {
            router.back();
          }
        },
      },
    );
  };

  return (
    <View style={[styles.container, { backgroundColor: T.pageBg }]}>
      <DomainHeader
        title="New channel"
        color={T.domains.chat}
        icon="chat"
        rightActions={
          <TouchableOpacity
            style={[styles.saveBtn, { backgroundColor: canSave ? T.domains.chat : T.surfaceHover }]}
            onPress={handleCreate}
            disabled={!canSave}
            activeOpacity={0.8}
          >
            {createChannel.isPending ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <Text style={[styles.saveBtnText, { color: canSave ? "#fff" : T.textDim }]}>
                Create
              </Text>
            )}
          </TouchableOpacity>
        }
      />

      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={[styles.label, { color: T.textDim }]}>NAME</Text>
        <View style={[styles.nameRow, { backgroundColor: T.surface, borderColor: T.border }]}>
          <Hash size={18} color={T.textDim} weight="bold" />
          <TextInput
            value={name}
            onChangeText={setName}
            placeholder="e.g. design-team"
            placeholderTextColor={T.textDim}
            style={[styles.nameInput, { color: T.textBright }]}
            autoFocus
            autoCapitalize="none"
            returnKeyType="next"
          />
        </View>

        <Text style={[styles.label, { color: T.textDim, marginTop: 22 }]}>TYPE</Text>
        <View style={styles.typeGroup}>
          {TYPES.map((t) => {
            const active = type === t.key;
            return (
              <TouchableOpacity
                key={t.key}
                style={[
                  styles.typeCard,
                  {
                    backgroundColor: active ? T.domains.chatSoft : T.surface,
                    borderColor: active ? T.domains.chat : T.border,
                  },
                ]}
                onPress={() => setType(t.key)}
                activeOpacity={0.7}
              >
                <t.Icon
                  key={active ? "fill" : "bold"}
                  size={20}
                  color={active ? T.domains.chat : T.textDim}
                  weight={active ? "fill" : "bold"}
                />
                <View style={{ flex: 1 }}>
                  <Text
                    style={[styles.typeLabel, { color: active ? T.domains.chat : T.textBright }]}
                  >
                    {t.label}
                  </Text>
                  <Text style={[styles.typeHint, { color: T.textDim }]}>{t.hint}</Text>
                </View>
              </TouchableOpacity>
            );
          })}
        </View>

        <Text style={[styles.label, { color: T.textDim, marginTop: 22 }]}>DESCRIPTION</Text>
        <TextInput
          value={description}
          onChangeText={setDescription}
          placeholder="What's this channel about? (optional)"
          placeholderTextColor={T.textDim}
          style={[
            styles.descInput,
            { color: T.textBright, backgroundColor: T.surface, borderColor: T.border },
          ]}
          multiline
        />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: 20 },
  label: { fontSize: 11, fontFamily: FONT.semibold, letterSpacing: 0.8, marginBottom: 8 },
  nameRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 14,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    height: 48,
  },
  nameInput: { flex: 1, fontSize: 15, fontFamily: FONT.medium },
  typeGroup: { gap: 10 },
  typeCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
  },
  typeLabel: { fontSize: 15, fontFamily: FONT.semibold },
  typeHint: { fontSize: 12, fontFamily: FONT.regular, marginTop: 2 },
  descInput: {
    minHeight: 90,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 14,
    fontSize: 15,
    fontFamily: FONT.regular,
    textAlignVertical: "top",
  },
  saveBtn: {
    paddingHorizontal: 16,
    paddingVertical: 7,
    borderRadius: 8,
    minWidth: 64,
    alignItems: "center",
  },
  saveBtnText: { fontSize: 14, fontFamily: FONT.semibold },
});
