import { useState, useRef, useCallback, useEffect } from "react";
import { TextInput } from "react-native";
import { useUniffy } from "@core/providers/UniffyContext";
import { useScreenFocusRef } from "@shared/hooks/useScreenFocusRef";

export const MENTION_RE = /\[\[\[([^|]+)\|([^\]]+)\]\]\]/g;

export type MentionEntry = { label: string; urn: string };

export const DOMAIN_TO_CONTENT_TYPE: Record<string, string> = {
  notes: "NOTE",
  files: "FILE",
  chat: "CHAT",
  calendar: "CALENDAR_EVENT",
  projects: "PROJECT",
  agents: "AGENT",
};

/** Parse canonical body into display text and mention entries */
export function parseMentions(canonical: string): { display: string; mentions: MentionEntry[] } {
  const mentions: MentionEntry[] = [];
  const display = canonical.replace(MENTION_RE, (_, label, urn) => {
    mentions.push({ label, urn });
    return `@${label}`;
  });
  return { display, mentions };
}

/** Rebuild canonical body from display text and mention entries */
export function toCanonical(display: string, mentions: MentionEntry[]): string {
  let result = display;
  const sorted = [...mentions].sort((a, b) => b.label.length - a.label.length);
  for (const { label, urn } of sorted) {
    result = result.replaceAll(`@${label}`, `[[[${label}|${urn}]]]`);
  }
  return result;
}

type Selection = { start: number; end: number };

export function useMentionInput(initialCanonical?: string) {
  const { pendingReference, clearPendingReference } = useUniffy();
  const screenFocused = useScreenFocusRef();

  const [initial] = useState(() =>
    initialCanonical
      ? parseMentions(initialCanonical)
      : { display: "", mentions: [] as MentionEntry[] },
  );

  const mentionsRef = useRef<MentionEntry[]>(initial.mentions);
  const cursorPosRef = useRef<number>(0);
  const inputRef = useRef<TextInput>(null);

  const [displayText, setDisplayText] = useState(initial.display);

  const [selection, setSelection] = useState<Selection>({ start: 0, end: 0 });

  const initFromCanonical = useCallback((canonical: string) => {
    const { display, mentions } = parseMentions(canonical);
    mentionsRef.current = mentions;
    setDisplayText(display);
  }, []);

  const getCanonical = useCallback(() => {
    return toCanonical(displayText, mentionsRef.current);
  }, [displayText]);

  const onSelectionChange = useCallback((e: { nativeEvent: { selection: Selection } }) => {
    const sel = e.nativeEvent.selection;
    setSelection(sel);
    cursorPosRef.current = sel.start;
  }, []);

  // Insert reference inline at cursor. Focus-guarded so a stacked screen's
  // composer does not also consume a reference picked elsewhere.
  useEffect(() => {
    if (pendingReference && screenFocused.current) {
      const contentType = DOMAIN_TO_CONTENT_TYPE[pendingReference.domain] || "NOTE";
      const urn = `urn:uniffy:content:${contentType}:${pendingReference.id}`;
      mentionsRef.current.push({ label: pendingReference.label, urn });

      const mention = `@${pendingReference.label}`;
      const pos = cursorPosRef.current;
      const before = displayText.substring(0, pos);
      const after = displayText.substring(pos);
      const needsSpaceBefore = before.length > 0 && !before.endsWith(" ") && !before.endsWith("\n");
      const needsSpaceAfter = after.length > 0 && !after.startsWith(" ") && !after.startsWith("\n");
      const insert = (needsSpaceBefore ? " " : "") + mention + (needsSpaceAfter ? " " : "");
      const newText = before + insert + after;
      setDisplayText(newText);
      const newPos = pos + insert.length;
      setSelection({ start: newPos, end: newPos });
      cursorPosRef.current = newPos;
      clearPendingReference();
      setTimeout(() => {
        inputRef.current?.focus();
        inputRef.current?.setSelection(newPos, newPos);
      }, 50);
    }
  }, [pendingReference, displayText, clearPendingReference, screenFocused]);

  return {
    displayText,
    setDisplayText,
    selection,
    onSelectionChange,
    getCanonical,
    inputRef,
    mentionsRef,
    initFromCanonical,
  };
}
