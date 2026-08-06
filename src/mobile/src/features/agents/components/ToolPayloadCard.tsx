import React from "react";
import { View, Text, StyleSheet } from "react-native";
import type { ThemeColors } from "@theme/theme";
import { FONT } from "@theme/typography";
import type { ReadablePayload } from "@features/agents/toolPayload";

/** What a tool was handed or handed back. Sits one shade under the pane that
 * hosts it, the way a quoted body sits under its chip header. */
export function ToolPayloadCard({
  T,
  title,
  payload,
}: {
  T: ThemeColors;
  title: string;
  payload: ReadablePayload;
}) {
  if (payload.kind === "empty") return null;

  return (
    <View style={[styles.card, { backgroundColor: T.bg, borderColor: T.border }]}>
      <Text style={[styles.title, { color: T.textDim }]}>{title}</Text>
      {payload.kind === "text" ? (
        <>
          <Text style={[styles.body, { color: T.text }]}>{payload.text}</Text>
          {payload.truncated ? <TrimmedNote T={T} /> : null}
        </>
      ) : (
        payload.fields.map((field) =>
          field.block ? (
            <View key={field.label} style={styles.blockField}>
              <Text style={[styles.fieldLabel, { color: T.textDim }]}>{field.label}</Text>
              <Text style={[styles.body, { color: T.text }]}>{field.value}</Text>
              {field.truncated ? <TrimmedNote T={T} /> : null}
            </View>
          ) : (
            <View key={field.label} style={styles.inlineField}>
              <Text style={[styles.fieldLabel, { color: T.textDim }]}>{field.label}</Text>
              <Text style={[styles.inlineValue, { color: T.text }]}>{field.value}</Text>
            </View>
          ),
        )
      )}
    </View>
  );
}

function TrimmedNote({ T }: { T: ThemeColors }) {
  return <Text style={[styles.trimmed, { color: T.textDim }]}>Trimmed - open on the web app</Text>;
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 10,
    paddingVertical: 9,
    gap: 7,
  },
  title: { fontSize: 10, fontFamily: FONT.bold, letterSpacing: 0.7, textTransform: "uppercase" },
  inlineField: { flexDirection: "row", alignItems: "flex-start", gap: 8 },
  inlineValue: { flex: 1, fontSize: 12, lineHeight: 17, fontFamily: FONT.regular },
  blockField: { gap: 3 },
  fieldLabel: { fontSize: 11, lineHeight: 17, fontFamily: FONT.medium },
  body: { fontSize: 12, lineHeight: 18, fontFamily: FONT.regular },
  trimmed: { fontSize: 10, fontFamily: FONT.medium, marginTop: 2 },
});
