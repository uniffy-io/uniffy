import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { PhoneCall, PhoneX, UserPlus, Info } from "phosphor-react-native";
import { useTheme } from "@shared/hooks/useTheme";
import { FONT } from "@theme/typography";

// Lifecycle breadcrumbs (call started/ended, channel joins) arrive as SYSTEM
// messages whose content is a backend-composed string with [[[label|urn]]] user
// mentions. They render as a single self-contained capsule so the actor,
// duration, and roster read as one unit instead of scattered inline chips.

type ThemeColors = ReturnType<typeof useTheme>;

const MENTION_RE = /\[\[\[([^|]+)\|([^\]]+)\]\]\]/g;
// Mirrors _format_call_duration: "Xh YYm" | "Xm YYs" | "Xs".
const DURATION_RE = /(\d+h \d{2}m|\d+m \d{2}s|\d+s)/;

type Part = { text: string } | { mention: string };

function parseParts(content: string): Part[] {
  const parts: Part[] = [];
  let last = 0;
  for (const match of content.matchAll(MENTION_RE)) {
    const offset = match.index ?? 0;
    if (offset > last) parts.push({ text: content.slice(last, offset) });
    parts.push({ mention: match[1] });
    last = offset + match[0].length;
  }
  if (last < content.length) parts.push({ text: content.slice(last) });
  return parts;
}

type EventKind = "call-start" | "call-end" | "join" | "generic";

function classify(content: string): EventKind {
  const t = content.toLowerCase();
  if (t.includes("started a call")) return "call-start";
  if (t.includes("ended the call") || t.includes("call ended")) return "call-end";
  if (t.includes("joined the channel")) return "join";
  return "generic";
}

const GLYPH: Record<EventKind, React.ComponentType<any>> = {
  "call-start": PhoneCall,
  "call-end": PhoneX,
  join: UserPlus,
  generic: Info,
};

function tintFor(kind: EventKind, T: ThemeColors): string {
  if (kind === "call-end") return T.red;
  if (kind === "generic") return T.textDim;
  return T.green;
}

// The backend joins segments with " - "; render it as a middot and lift the
// duration to a tabular emphasis so the line reads as one sentence.
function renderText(text: string, keyBase: number, T: ThemeColors): React.ReactNode[] {
  const cleaned = text.replace(/ - /g, " · ");
  return cleaned.split(DURATION_RE).map((segment, i) => {
    if (!segment) return null;
    if (i % 2 === 1) {
      return (
        <Text
          key={`${keyBase}-${i}`}
          style={{ color: T.text, fontFamily: FONT.semibold, fontVariant: ["tabular-nums"] }}
        >
          {segment}
        </Text>
      );
    }
    return <Text key={`${keyBase}-${i}`}>{segment}</Text>;
  });
}

export function SystemMessage({ content }: { content: string }) {
  const T = useTheme();
  const parts = parseParts(content);
  const kind = classify(content);
  const Glyph = GLYPH[kind];
  const tint = tintFor(kind, T);

  return (
    <View style={styles.row}>
      <View style={[styles.capsule, { backgroundColor: T.surface, borderColor: T.border }]}>
        <View style={[styles.badge, { backgroundColor: tint + "22" }]}>
          <Glyph size={12} color={tint} weight="fill" />
        </View>
        <Text style={[styles.text, { color: T.textDim }]}>
          {parts.map((part, i) =>
            "mention" in part ? (
              <Text key={i} style={{ color: T.text, fontFamily: FONT.semibold }}>
                {part.mention}
              </Text>
            ) : (
              renderText(part.text, i, T)
            ),
          )}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { paddingHorizontal: 16, paddingVertical: 6, alignItems: "center" },
  capsule: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "center",
    maxWidth: "90%",
    gap: 7,
    paddingLeft: 6,
    paddingRight: 12,
    paddingVertical: 5,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
  },
  badge: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
  },
  text: { flexShrink: 1, fontSize: 12, fontFamily: FONT.regular, lineHeight: 18 },
});
