import React from "react";
import { View, Text, StyleSheet, ScrollView, Platform, Linking } from "react-native";
import { router } from "expo-router";
import { useTheme } from "@shared/hooks/useTheme";
import { FONT } from "@theme/typography";
import { ReferenceChip } from "@shared/mentions/ReferenceChip";
import { isBroadcastUrn } from "@shared/mentions/broadcastMentions";
import { MentionToken, isPeopleTokenUrnType } from "@shared/mentions/MentionToken";
import type { Domain } from "@core/types";

const MENTION_RE = /\[\[\[([^[\]|]+)\|([^\]]+)\]\]\]/g;

const HEADING_RE = /^#{1,6}\s+\S/;

const MONO_FONT = Platform.select({ ios: "Menlo", default: "monospace" });

const CONTENT_TYPE_TO_DOMAIN: Record<string, Domain> = {
  NOTE: "notes",
  FILE: "files",
  CHAT: "chat",
  CALENDAR_EVENT: "calendar",
  PROJECT: "projects",
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
  | { type: "strike"; text: string }
  | { type: "highlight"; text: string }
  | { type: "link"; text: string; url: string }
  | { type: "code"; text: string }
  | { type: "mention"; label: string; urn: string };

type ThemeColors = ReturnType<typeof useTheme>;

function openLink(url: string) {
  Linking.openURL(url).catch(() => {});
}

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
      for (const part of parseInlineSpans(segment)) {
        parts.push(part);
      }
    }
  }
  return parts.length > 0 ? parts : [{ type: "text", text, bold: false, italic: false }];
}

function parseInlineSpans(text: string): InlinePart[] {
  const parts: InlinePart[] = [];
  // Order matters: links before emphasis so [a](b) is not eaten by other rules;
  // bold/italic keep the lookarounds that separate ** from a lone *.
  const re =
    /\[([^\]]+)\]\(([^)]+)\)|~~(.+?)~~|==(.+?)==|\*\*\*(.+?)\*\*\*|\*\*(.+?)\*\*|(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g;
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
    if (match[1] !== undefined) parts.push({ type: "link", text: match[1], url: match[2] });
    else if (match[3] !== undefined) parts.push({ type: "strike", text: match[3] });
    else if (match[4] !== undefined) parts.push({ type: "highlight", text: match[4] });
    else if (match[5] !== undefined)
      parts.push({ type: "text", text: match[5], bold: true, italic: true });
    else if (match[6] !== undefined)
      parts.push({ type: "text", text: match[6], bold: true, italic: false });
    else if (match[7] !== undefined)
      parts.push({ type: "text", text: match[7], bold: false, italic: true });
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) {
    parts.push({ type: "text", text: text.substring(lastIndex), bold: false, italic: false });
  }
  return parts;
}

function mentionUrnType(urn: string): string | null {
  const match = urn.match(/urn:uniffy:content:([^:]+):/);
  return match ? match[1] : null;
}

// People and broadcast tokens are nested Text and flow with the line; only
// boxed chips need the flex-wrap row layout that breaks natural text wrapping.
function hasChipMentions(parts: InlinePart[]): boolean {
  return parts.some(
    (p) =>
      p.type === "mention" &&
      !isPeopleTokenUrnType(mentionUrnType(p.urn)) &&
      !isBroadcastUrn(p.urn),
  );
}

function renderTextParts(
  parts: InlinePart[],
  T: ThemeColors,
  kp: number | string = 0,
  onMentionPress?: (urn: string, label: string) => void,
) {
  return parts.map((part, i) => {
    if (part.type === "mention") {
      return (
        <MentionToken
          key={`${kp}-m${i}`}
          urn={part.urn}
          label={part.label}
          onPress={onMentionPress ? () => onMentionPress(part.urn, part.label) : undefined}
        />
      );
    }
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
    if (part.type === "strike") {
      return (
        <Text key={`${kp}-${i}`} style={{ textDecorationLine: "line-through", color: T.textDim }}>
          {part.text}
        </Text>
      );
    }
    if (part.type === "highlight") {
      return (
        <Text key={`${kp}-${i}`} style={{ backgroundColor: T.yellow + "33", color: T.textBright }}>
          {part.text}
        </Text>
      );
    }
    if (part.type === "link") {
      return (
        <Text
          key={`${kp}-${i}`}
          style={{ color: T.accent, textDecorationLine: "underline" }}
          onPress={() => openLink(part.url)}
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
      const urnType = urnMatch ? urnMatch[1] : null;
      if (isPeopleTokenUrnType(urnType) || isBroadcastUrn(part.urn)) {
        return (
          <MentionToken
            key={`${kp}-m${i}`}
            urn={part.urn}
            label={part.label}
            textStyle={textStyle}
            onPress={onMentionPress ? () => onMentionPress(part.urn, part.label) : undefined}
          />
        );
      }
      const domain = urnType ? CONTENT_TYPE_TO_DOMAIN[urnType] : null;
      const refId = urnMatch ? urnMatch[2] : null;
      if (!domain) {
        if (urnType === "GROUP") {
          return (
            <ReferenceChip
              key={`${kp}-m${i}`}
              domain="group"
              label={part.label}
              onPress={onMentionPress ? () => onMentionPress(part.urn, part.label) : undefined}
            />
          );
        }
        // No mobile surface for this type - style it, don't chip it.
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
    if (part.type === "strike") {
      return (
        <Text
          key={`${kp}-${i}`}
          style={[textStyle, { textDecorationLine: "line-through", color: T.textDim }]}
        >
          {part.text}
        </Text>
      );
    }
    if (part.type === "highlight") {
      return (
        <Text
          key={`${kp}-${i}`}
          style={[textStyle, { backgroundColor: T.yellow + "33", color: T.textBright }]}
        >
          {part.text}
        </Text>
      );
    }
    if (part.type === "link") {
      return (
        <Text
          key={`${kp}-${i}`}
          style={[textStyle, { color: T.accent, textDecorationLine: "underline" }]}
          onPress={() => openLink(part.url)}
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
  if (!hasChipMentions(parts)) {
    return (
      <Text key={index} style={textStyle}>
        {renderTextParts(parts, T, index, onMentionPress)}
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
        {hasChipMentions(parts) ? (
          <View style={styles.inlineRow}>
            {renderMixedParts(parts, T, textStyle, onMentionPress, index)}
          </View>
        ) : (
          <Text style={textStyle}>{renderTextParts(parts, T, index, onMentionPress)}</Text>
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
        {hasChipMentions(parts) ? (
          <View style={[styles.inlineRow, { flex: 1 }]}>
            {renderMixedParts(parts, T, textStyle, onMentionPress, index)}
          </View>
        ) : (
          <Text style={textStyle}>{renderTextParts(parts, T, index, onMentionPress)}</Text>
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
        {hasChipMentions(parts) ? (
          <View style={[styles.inlineRow, { flex: 1 }]}>
            {renderMixedParts(parts, T, textStyle, onMentionPress, index)}
          </View>
        ) : (
          <Text style={textStyle}>{renderTextParts(parts, T, index, onMentionPress)}</Text>
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
        {hasChipMentions(parts) ? (
          <View style={[styles.inlineRow, { flex: 1 }]}>
            {renderMixedParts(parts, T, textStyle, onMentionPress, index)}
          </View>
        ) : (
          <Text style={textStyle}>{renderTextParts(parts, T, index, onMentionPress)}</Text>
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
        {hasChipMentions(parts) ? (
          <View style={[styles.inlineRow, { flex: 1 }]}>
            {renderMixedParts(parts, T, textStyle, onMentionPress, index)}
          </View>
        ) : (
          <Text style={textStyle}>{renderTextParts(parts, T, index, onMentionPress)}</Text>
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

type MentionLineProps = {
  content: string;
  textStyle?: any;
  wrapperStyle?: any;
  onMentionPress?: (urn: string, label: string) => void;
};

/** Single line of mention-aware text (system messages, previews) - no block markdown. */
export function MentionLine({
  content,
  textStyle,
  wrapperStyle,
  onMentionPress,
}: MentionLineProps) {
  const T = useTheme();
  const parts = parseInlineWithMentions(content);
  if (!hasChipMentions(parts)) {
    return <Text style={textStyle}>{renderTextParts(parts, T, 0, onMentionPress)}</Text>;
  }
  return (
    <View style={[styles.inlineRow, wrapperStyle]}>
      {renderMixedParts(parts, T, textStyle, onMentionPress)}
    </View>
  );
}

type MarkdownRendererProps = {
  content: string;
  onMentionPress?: (urn: string, label: string) => void;
  /** Reports each heading's y within this renderer's parent, in the same order
   * parseHeadings returns them, so an outline can scroll to one. */
  onHeadingLayout?: (headingIndex: number, y: number) => void;
};

// Memoized: parsing runs on every render and a chat transcript mounts a
// screenful of these, so an unchanged body must not be re-tokenized because
// something else on the screen moved.
export const MarkdownRenderer = React.memo(function MarkdownRenderer({
  content,
  onMentionPress,
  onHeadingLayout,
}: MarkdownRendererProps) {
  const T = useTheme();
  const lines = content.split("\n");
  const elements: React.ReactNode[] = [];
  let i = 0;
  let headingIndex = 0;

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

    const rendered = renderMarkdownLine(line, T, i, onMentionPress);

    // Headings are counted here, after the code-fence and table branches have
    // consumed their lines, so the ordinals line up with parseHeadings.
    if (HEADING_RE.test(line)) {
      const ordinal = headingIndex++;
      elements.push(
        <View key={`h-${i}`} onLayout={(e) => onHeadingLayout?.(ordinal, e.nativeEvent.layout.y)}>
          {rendered}
        </View>,
      );
    } else {
      elements.push(rendered);
    }
    i++;
  }

  return <>{elements}</>;
});

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
