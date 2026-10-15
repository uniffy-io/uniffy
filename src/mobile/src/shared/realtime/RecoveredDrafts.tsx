import { useState } from "react";
import { ScrollView, Share, Text, TouchableOpacity, View } from "react-native";
import { BottomSheet } from "@shared/components/BottomSheet";
import { SheetHeader } from "@shared/components/SheetHeader";
import { useTheme } from "@shared/hooks/useTheme";
import type { MobileRecoveredDraft } from "@shared/realtime/draftStorage";

export function RecoveredDrafts({
  drafts,
  editable,
  onRestore,
  onDiscard,
}: {
  drafts: MobileRecoveredDraft[];
  editable: boolean;
  onRestore: (draft: MobileRecoveredDraft) => Promise<void>;
  onDiscard: (id: string) => Promise<void>;
}) {
  const T = useTheme();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch {
      setError("Could not update stored draft. Try again.");
    } finally {
      setBusy(false);
    }
  };
  if (drafts.length === 0) return null;
  return (
    <>
      <TouchableOpacity
        accessibilityRole="button"
        onPress={() => setOpen(true)}
        style={{ padding: 12 }}
      >
        <Text style={{ color: T.text }}>Recovered drafts ({drafts.length})</Text>
      </TouchableOpacity>
      <BottomSheet visible={open} onClose={() => setOpen(false)}>
        <SheetHeader
          title="Recovered drafts"
          actions={[{ label: "Close", onPress: () => setOpen(false) }]}
          busy={busy}
        />
        <ScrollView contentContainerStyle={{ padding: 16, gap: 20 }}>
          <Text style={{ color: T.textDim }}>
            Review each draft. Insert adds draft text after current content. Discard removes this
            device copy.
          </Text>
          {error && (
            <Text accessibilityRole="alert" style={{ color: T.text }}>
              {error}
            </Text>
          )}
          {drafts.map((draft) => (
            <View key={draft.id} style={{ gap: 8 }}>
              <Text selectable style={{ color: T.text }}>
                {draft.text || "Empty draft"}
              </Text>
              <View style={{ flexDirection: "row", gap: 16 }}>
                {editable && (
                  <TouchableOpacity
                    disabled={busy}
                    accessibilityRole="button"
                    onPress={() => void run(() => onRestore(draft))}
                    style={{ paddingVertical: 12 }}
                  >
                    <Text style={{ color: T.accent }}>Insert draft</Text>
                  </TouchableOpacity>
                )}
                <TouchableOpacity
                  disabled={busy}
                  accessibilityRole="button"
                  onPress={() =>
                    void run(async () => {
                      await Share.share({ title: "Recovered draft", message: draft.text });
                    })
                  }
                  style={{ paddingVertical: 12 }}
                >
                  <Text style={{ color: T.text }}>Export</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  disabled={busy}
                  accessibilityRole="button"
                  onPress={() => void run(() => onDiscard(draft.id))}
                  style={{ paddingVertical: 12 }}
                >
                  <Text style={{ color: T.textDim }}>Discard</Text>
                </TouchableOpacity>
              </View>
            </View>
          ))}
        </ScrollView>
      </BottomSheet>
    </>
  );
}
