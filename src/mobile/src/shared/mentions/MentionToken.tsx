import React from "react";
import { Text } from "react-native";
import { useAuth } from "@core/providers/AuthContext";
import { useTheme } from "@shared/hooks/useTheme";
import { isBroadcastUrn } from "@shared/mentions/broadcastMentions";
import { FONT } from "@theme/typography";

export const PEOPLE_TOKEN_URN_TYPES: ReadonlySet<string> = new Set(["USER", "AGENT", "TEAM"]);

export function isPeopleTokenUrnType(urnType: string | null): boolean {
  return urnType !== null && PEOPLE_TOKEN_URN_TYPES.has(urnType);
}

type MentionTokenProps = {
  urn: string;
  label: string;
  textStyle?: any;
  onPress?: () => void;
};

/** Slack-style `@Name` text token for USER, AGENT, and TEAM mentions with one
 *  accent for every subject kind, mirroring the web `peopleTokenClasses`
 *  contract: no box, no avatar, no presence. Rendered as nested Text so tokens
 *  wrap and baseline-align with the surrounding line. Thin spaces stand in for
 *  horizontal padding, which nested Text does not support on Android. */
export function MentionToken({ urn, label, textStyle, onPress }: MentionTokenProps) {
  const T = useTheme();
  const { user } = useAuth();
  // A broadcast pings the viewer, so every reader gets the self-mention wash.
  const broadcast = isBroadcastUrn(urn);
  const selfMention = broadcast || (!!user && urn === `urn:uniffy:content:USER:${user.id}`);
  const display = broadcast ? label.replace(/^@+/, "") : label;
  return (
    <Text
      style={[
        textStyle,
        {
          color: T.accent,
          fontFamily: FONT.medium,
          backgroundColor: T.accent + (selfMention ? "40" : "1A"),
        },
      ]}
      onPress={broadcast ? undefined : onPress}
      suppressHighlighting
    >
      {"\u2009@" + display + "\u2009"}
    </Text>
  );
}
