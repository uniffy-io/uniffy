import React from "react";
import { View, Text, StyleSheet, ScrollView, Platform } from "react-native";
import { router } from "expo-router";
import { useTheme } from "@/hooks/useTheme";
import { FONT } from "@/constants/typography";
import { ReferenceChip } from "@/components/ReferenceChip";
import type { Domain } from "@/lib/types";

const MENTION_RE = /\[\[\[([^|]+)\|([^\]]+)\]\]\]/g;

const MONO_FONT = Platform.select({ ios: "Menlo", default: "monospace" });

const CONTENT_TYPE_TO_DOMAIN: Record<string, Domain> = {
  NOTE: "notes",
  FILE: "files",
  CHAT: "chat",
  CALENDAR_EVENT: "calendar",
  PROJECT: "projects",
  AGENT: "agents",
};

// Domains with a /{domain}/[id] detail route mentions can navigate to.
const NAVIGABLE_DOMAINS: ReadonlySet<Domain> = new Set([
  "notes",
  "files",
  "chat",
  "calendar",
  "projects",
]);

type InlinePart =
  | { type: "text"; text: string; bold: boolean; italic: boolean }
  | { type: "code"; text: string }
  | { type: "mention"; label: string; urn: string };

type ThemeColors = ReturnType<typeof useTheme>;

function parseInlineWithMentions(text: string): InlinePart[] {
  const parts: InlinePart[] = [];
  const mentionSplit = text.split(MENTION_RE);
  for (let i = 0; i < mentionSplit.length; i++) {
    if (i % 3 === 0) {
      const segment = mentionSplit[i];
      if (segment) {
        for (const part of parseInlineFormatting(segment)) {
          parts.push(part);
        }
      }
    } else if (i % 3 === 1) {
      parts.push({ type: "mention", label: mentionSplit[i], urn: mentionSplit[i + 1] || "" });
    }
  }
  return parts;
}

function parseInlineFormatting(text: string): InlinePart[] {
  // Code spans first: their contents are exempt from bold/italic parsing.
  const parts: InlinePart[] = [];
  const codeSplit = text.split(/(`[^`]+`)/g);
  for (let i = 0; i < codeSplit.length; i++) {
    const segment = codeSplit[i];
    if (!segment) continue;
    if (i % 2 === 1) {
      parts.push({ type: "code", text: segment.slice(1, -1) });
    } else {
      for (const part of parseEmphasis(segment)) {
        parts.push(part);
      }
    }
  }
  return parts.length > 0 ? parts : [{ type: "text", text, bold: false, italic: false }];
}

function parseEmphasis(text: string): InlinePart[] {
  const parts: InlinePart[] = [];
  const re = /(\*\*\*(.+?)\*\*\*|\*\*(.+?)\*\*|(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*))/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push({
        type: "text",
        text: text.substring(lastIndex, match.index),
        bold: false,
        italic: false,
      });
    }
    if (match[2]) parts.push({ type: "text", text: match[2], bold: true, italic: true });
    else if (match[3]) parts.push({ type: "text", text: match[3], bold: true, italic: false });
    else if (match[4]) parts.push({ type: "text", text: match[4], bold: false, italic: true });
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) {
    parts.push({ type: "text", text: text.substring(lastIndex), bold: false, italic: false });
  }
  return parts;
}

function hasMentions(parts: InlinePart[]): boolean {
  return parts.some((p) => p.type === "mention");
}

function renderTextParts(parts: InlinePart[], T: ThemeColors, kp: number | string = 0) {
  return parts.map((part, i) => {
    if (part.type === "code") {
      return (
        <Text
          key={`${kp}-${i}`}
          style={[styles.inlineCode, { backgroundColor: T.surfaceHover, color: T.textBright }]}
        >
          {part.text}
        </Text>
      );
    }
    if (part.type !== "text") return null;
    if (part.bold && part.italic) {
      return (
        <Text
          key={`${kp}-${i}`}
          style={{ fontFamily: FONT.bold, fontStyle: "italic", color: T.textBright }}
        >
          {part.text}
        </Text>
      );
    }
    if (part.bold) {
      return (
        <Text key={`${kp}-${i}`} style={{ fontFamily: FONT.bold, color: T.textBright }}>
          {part.text}
        </Text>
      );
    }
    if (part.italic) {
      return (
        <Text key={`${kp}-${i}`} style={{ fontStyle: "italic", color: T.text }}>
          {part.text}
        </Text>
      );
    }
    return <Text key={`${kp}-${i}`}>{part.text}</Text>;
  });
}

function renderMixedParts(
  parts: InlinePart[],
  T: ThemeColors,
  textStyle: any,
  onMentionPress?: (urn: string, label: string) => void,
  kp: number | string = 0,
) {
  return parts.map((part, i) => {
    if (part.type === "mention") {
      const urnMatch = part.urn.match(/urn:uniffy:content:([^:]+):(.+)/);
      const domain = urnMatch ? CONTENT_TYPE_TO_DOMAIN[urnMatch[1]] : null;
      const refId = urnMatch ? urnMatch[2] : null;
      if (!domain) {
        // No mobile surface for this type (e.g. USER) - style it, don't chip it.
        return (
          <Text
            key={`${kp}-m${i}`}
            style={[textStyle, { fontFamily: FONT.semibold, color: T.accent }]}
          >
            @{part.label}
          </Text>
        );
      }
      const handlePress = onMentionPress
        ? () => onMentionPress(part.urn, part.label)
        : refId && NAVIGABLE_DOMAINS.has(domain)
          ? () => router.push(`/${domain}/${refId}` as any)
          : undefined;
      return (
        <ReferenceChip
          key={`${kp}-m${i}`}
          domain={domain}
          label={part.label}
          onPress={handlePress}
        />
      );
    }
    if (part.type === "code") {
      return (
        <Text
          key={`${kp}-${i}`}
          style={[
            textStyle,
            styles.inlineCode,
            { backgroundColor: T.surfaceHover, color: T.textBright },
          ]}
        >
          {part.text}
        </Text>
      );
    }
    if (!part.text) return null;
    if (part.bold && part.italic) {
      return (
        <Text
          key={`${kp}-${i}`}
          style={[textStyle, { fontFamily: FONT.bold, fontStyle: "italic" }]}
        >
          {part.text}
        </Text>
      );
    }
    if (part.bold) {
      return (
        <Text
          key={`${kp}-${i}`}
          style={[textStyle, { fontFamily: FONT.bold, color: T.textBright }]}
        >
          {part.text}
        </Text>
      );
    }
    if (part.italic) {
      return (
        <Text key={`${kp}-${i}`} style={[textStyle, { fontStyle: "italic" }]}>
          {part.text}
        </Text>
      );
    }
    return (
      <Text key={`${kp}-${i}`} style={textStyle}>
        {part.text}
      </Text>
    );
  });
}

function renderLineContent(
  content: string,
  T: ThemeColors,
  index: number,
  textStyle: any,
  wrapperStyle?: any,
  onMentionPress?: (urn: string, label: string) => void,
) {
  const parts = parseInlineWithMentions(content);
  if (!hasMentions(parts)) {
    return (
      <Text key={index} style={textStyle}>
        {renderTextParts(parts, T, index)}
      </Text>
    );
  }
  return (
    <View key={index} style={[styles.inlineRow, wrapperStyle]}>
      {renderMixedParts(parts, T, textStyle, onMentionPress, index)}
    </View>
  );
}

function renderCodeBlock(code: string, language: string, key: number, T: ThemeColors) {
  return (
    <View
      key={`code-${key}`}
      style={[styles.codeBlock, { borderColor: T.border, backgroundColor: T.surface }]}
    >
      {language ? (
        <Text style={[styles.codeBlockLang, { color: T.textDim }]}>{language}</Text>
      ) : null}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} bounces={false}>
        <Text style={[styles.codeBlockText, { color: T.textBright }]}>{code}</Text>
      </ScrollView>
    </View>
  );
}

function isTableSeparator(line: string) {
  return /^\|[\s:|-]+\|$/.test(line.trim());
}

function parseTableRow(line: string): string[] {
  return line
    .split("|")
    .slice(1, -1)
    .map((cell) => cell.trim());
}

function renderTable(rows: string[], startIndex: number, T: ThemeColors) {
  const dataRows: string[][] = [];
  let headerRow: string[] | null = null;

  for (let i = 0; i < rows.length; i++) {
    if (isTableSeparator(rows[i])) continue;
    const cells = parseTableRow(rows[i]);
    if (!headerRow) {
      headerRow = cells;
    } else {
      dataRows.push(cells);
    }
  }

  if (!headerRow) return null;
  const colCount = headerRow.length;

  return (
    <View key={`table-${startIndex}`} style={[styles.table, { borderColor: T.border }]}>
      <View style={[styles.tableRow, { backgroundColor: T.surface, borderBottomColor: T.border }]}>
        {headerRow.map((cell, ci) => (
          <View
            key={ci}
            style={[
              styles.tableCell,
              ci < colCount - 1 && {
                borderRightColor: T.border,
                borderRightWidth: StyleSheet.hairlineWidth,
              },
            ]}
          >
            <Text style={[styles.tableCellTextBold, { color: T.textBright }]} numberOfLines={2}>
              {cell}
            </Text>
          </View>
        ))}
      </View>
      {dataRows.map((row, ri) => (
        <View
          key={ri}
          style={[
            styles.tableRow,
            ri < dataRows.length - 1 && {
              borderBottomColor: T.border,
              borderBottomWidth: StyleSheet.hairlineWidth,
            },
          ]}
        >
          {row.slice(0, colCount).map((cell, ci) => (
            <View
              key={ci}
              style={[
                styles.tableCell,
                ci < colCount - 1 && {
                  borderRightColor: T.border,
                  borderRightWidth: StyleSheet.hairlineWidth,
                },
              ]}
            >
              <Text style={[styles.tableCellText, { color: T.text }]} numberOfLines={2}>
                {cell}
              </Text>
            </View>
          ))}
          {row.length < colCount &&
            Array.from({ length: colCount - row.length }).map((_, ci) => (
              <View
                key={`empty-${ci}`}
                style={[
                  styles.tableCell,
                  ci + row.length < colCount - 1 && {
                    borderRightColor: T.border,
                    borderRightWidth: StyleSheet.hairlineWidth,
                  },
                ]}
              />
            ))}
        </View>
      ))}
    </View>
  );
}

function renderMarkdownLine(
  line: string,
  T: ThemeColors,
  index: number,
  onMentionPress?: (urn: string, label: string) => void,
): React.ReactNode {
  const render = (content: string, textStyle: any, wrapperStyle?: any) =>
    renderLineContent(content, T, index, textStyle, wrapperStyle, onMentionPress);

  if (line.startsWith("# ")) {
    return render(line.substring(2), [styles.mdH1, { color: T.textBright }]);
  }
  if (line.startsWith("## ")) {
    return render(line.substring(3), [styles.mdH2, { color: T.textBright }]);
  }
  if (line.startsWith("#### ")) {
    return render(line.substring(5), [styles.mdH4, { color: T.textBright }]);
  }
  if (line.startsWith("### ")) {
    return render(line.substring(4), [styles.mdH3, { color: T.textBright }]);
  }
  if (line.startsWith("> ")) {
    const parts = parseInlineWithMentions(line.substring(2));
    const textStyle = [styles.mdBlockquoteText, { color: T.textDim }];
    return (
      <View key={index} style={[styles.mdBlockquote, { borderLeftColor: T.accent }]}>
        {hasMentions(parts) ? (
          <View style={styles.inlineRow}>
            {renderMixedParts(parts, T, textStyle, onMentionPress, index)}
          </View>
        ) : (
          <Text style={textStyle}>{renderTextParts(parts, T, index)}</Text>
        )}
      </View>
    );
  }
  if (line.startsWith("- [x] ")) {
    const parts = parseInlineWithMentions(line.substring(6));
    const textStyle = [
      styles.mdCheckText,
      { color: T.textDim, textDecorationLine: "line-through" as const },
    ];
    return (
      <View key={index} style={styles.mdCheckItem}>
        <View style={[styles.mdCheckBox, { backgroundColor: T.accent, borderColor: T.accent }]}>
          <Text style={styles.mdCheckMark}>✓</Text>
        </View>
        {hasMentions(parts) ? (
          <View style={[styles.inlineRow, { flex: 1 }]}>
            {renderMixedParts(parts, T, textStyle, onMentionPress, index)}
          </View>
        ) : (
          <Text style={textStyle}>{renderTextParts(parts, T, index)}</Text>
        )}
      </View>
    );
  }
  if (line.startsWith("- [ ] ")) {
    const parts = parseInlineWithMentions(line.substring(6));
    const textStyle = [styles.mdCheckText, { color: T.text }];
    return (
      <View key={index} style={styles.mdCheckItem}>
        <View style={[styles.mdCheckBox, { borderColor: T.border }]} />
        {hasMentions(parts) ? (
          <View style={[styles.inlineRow, { flex: 1 }]}>
            {renderMixedParts(parts, T, textStyle, onMentionPress, index)}
          </View>
        ) : (
          <Text style={textStyle}>{renderTextParts(parts, T, index)}</Text>
        )}
      </View>
    );
  }
  if (line.startsWith("- ")) {
    const parts = parseInlineWithMentions(line.substring(2));
    const textStyle = [styles.mdListText, { color: T.text }];
    return (
      <View key={index} style={styles.mdListItem}>
        <View style={[styles.mdBullet, { backgroundColor: T.textDim }]} />
        {hasMentions(parts) ? (
          <View style={[styles.inlineRow, { flex: 1 }]}>
            {renderMixedParts(parts, T, textStyle, onMentionPress, index)}
          </View>
        ) : (
          <Text style={textStyle}>{renderTextParts(parts, T, index)}</Text>
        )}
      </View>
    );
  }
  const numberedMatch = line.match(/^(\d+)\.\s(.+)/);
  if (numberedMatch) {
    const parts = parseInlineWithMentions(numberedMatch[2]);
    const textStyle = [styles.mdListText, { color: T.text }];
    return (
      <View key={index} style={styles.mdListItem}>
        <Text style={[styles.mdNumberLabel, { color: T.textDim }]}>{numberedMatch[1]}.</Text>
        {hasMentions(parts) ? (
          <View style={[styles.inlineRow, { flex: 1 }]}>
            {renderMixedParts(parts, T, textStyle, onMentionPress, index)}
          </View>
        ) : (
          <Text style={textStyle}>{renderTextParts(parts, T, index)}</Text>
        )}
      </View>
    );
  }
  if (/^(---+|\*\*\*+|___+)\s*$/.test(line)) {
    return <View key={index} style={[styles.mdHr, { backgroundColor: T.border }]} />;
  }
  if (line === "") {
    return <View key={index} style={styles.mdEmptyLine} />;
  }
  return render(line, [styles.bodyText, { color: T.text }]);
}

type MarkdownRendererProps = {
  content: string;
  onMentionPress?: (urn: string, label: string) => void;
};

export function MarkdownRenderer({ content, onMentionPress }: MarkdownRendererProps) {
  const T = useTheme();
  const lines = content.split("\n");
  const elements: React.ReactNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (line.trimStart().startsWith("```")) {
      const blockStart = i;
      const language = line.trim().slice(3).trim();
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trimStart().startsWith("```")) {
        codeLines.push(lines[i]);
        i++;
      }
      i++; // consume the closing fence (or run past the end for an unterminated block)
      elements.push(renderCodeBlock(codeLines.join("\n"), language, blockStart, T));
      continue;
    }

    if (line.trimStart().startsWith("|")) {
      const tableStart = i;
      const tableLines: string[] = [];
      while (i < lines.length && lines[i].trimStart().startsWith("|")) {
        tableLines.push(lines[i]);
        i++;
      }
      const table = renderTable(tableLines, tableStart, T);
      if (table) elements.push(table);
      continue;
    }

    elements.push(renderMarkdownLine(line, T, i, onMentionPress));
    i++;
  }

  return <>{elements}</>;
}

const styles = StyleSheet.create({
  inlineRow: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 4 },
  mdH1: {
    fontSize: 22,
    fontFamily: FONT.bold,
    lineHeight: 30,
    marginTop: 16,
    marginBottom: 6,
  },
  mdH2: {
    fontSize: 18,
    fontFamily: FONT.bold,
    lineHeight: 26,
    marginTop: 14,
    marginBottom: 4,
  },
  mdH3: {
    fontSize: 15,
    fontFamily: FONT.semibold,
    lineHeight: 22,
    marginTop: 12,
    marginBottom: 4,
  },
  mdH4: {
    fontSize: 14,
    fontFamily: FONT.semibold,
    lineHeight: 20,
    marginTop: 10,
    marginBottom: 2,
  },
  bodyText: { fontSize: 15, fontFamily: FONT.regular, lineHeight: 24 },
  mdBlockquote: { borderLeftWidth: 3, paddingLeft: 12, marginVertical: 6 },
  mdBlockquoteText: {
    fontSize: 15,
    fontFamily: FONT.regular,
    lineHeight: 24,
    fontStyle: "italic",
  },
  mdListItem: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    marginBottom: 4,
    paddingLeft: 4,
  },
  mdBullet: { width: 5, height: 5, borderRadius: 2.5, marginTop: 10 },
  mdListText: { flex: 1, fontSize: 15, fontFamily: FONT.regular, lineHeight: 24 },
  mdNumberLabel: { fontSize: 15, fontFamily: FONT.medium, lineHeight: 24, minWidth: 20 },
  mdCheckItem: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    marginBottom: 6,
    paddingLeft: 4,
  },
  mdCheckBox: {
    width: 18,
    height: 18,
    borderRadius: 4,
    borderWidth: 1.5,
    marginTop: 4,
    alignItems: "center",
    justifyContent: "center",
  },
  mdCheckMark: { color: "#fff", fontSize: 11, fontFamily: FONT.bold },
  mdCheckText: { flex: 1, fontSize: 15, fontFamily: FONT.regular, lineHeight: 24 },
  mdHr: { height: StyleSheet.hairlineWidth, marginVertical: 12 },
  mdEmptyLine: { height: 10 },
  inlineCode: { fontFamily: MONO_FONT, fontSize: 13 },
  codeBlock: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginVertical: 6,
  },
  codeBlockLang: { fontSize: 11, fontFamily: FONT.medium, marginBottom: 6 },
  codeBlockText: { fontFamily: MONO_FONT, fontSize: 13, lineHeight: 19 },
  table: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 8,
    overflow: "hidden",
    marginVertical: 8,
  },
  tableRow: { flexDirection: "row", borderBottomWidth: StyleSheet.hairlineWidth },
  tableCell: { flex: 1, paddingHorizontal: 10, paddingVertical: 8 },
  tableCellText: { fontSize: 13, fontFamily: FONT.regular, lineHeight: 18 },
  tableCellTextBold: { fontSize: 13, fontFamily: FONT.semibold, lineHeight: 18 },
});
