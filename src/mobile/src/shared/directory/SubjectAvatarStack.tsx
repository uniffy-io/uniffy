import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { Avatar } from "@shared/components/Avatar";
import { useTheme } from "@shared/hooks/useTheme";
import { useDirectory } from "@shared/permissions/usePermissions";
import { FONT } from "@theme/typography";

/**
 * Overlapping avatars for a set of subject ids, with a "+n" chip past `max`.
 * Ids the directory cannot resolve still render - a removed member keeps a
 * neutral initial rather than silently shrinking the stack.
 */
export function SubjectAvatarStack({
  subjectIds,
  size = 22,
  max = 3,
}: {
  subjectIds: string[];
  size?: number;
  max?: number;
}) {
  const T = useTheme();
  const { byId } = useDirectory();

  if (subjectIds.length === 0) return null;

  const shown = subjectIds.slice(0, max);
  const overflow = subjectIds.length - shown.length;
  const overlap = Math.round(size * 0.3);

  return (
    <View style={styles.stack}>
      {shown.map((id, index) => (
        <View
          key={id}
          style={[
            index > 0 && { marginLeft: -overlap },
            styles.ring,
            { borderColor: T.surface, borderRadius: size / 2 + 1 },
          ]}
        >
          <Avatar
            name={byId.get(id)?.name ?? "?"}
            avatarUrl={byId.get(id)?.avatarUrl}
            size={size}
            circle
          />
        </View>
      ))}
      {overflow > 0 && (
        <View
          style={[
            styles.more,
            styles.ring,
            {
              marginLeft: -overlap,
              width: size,
              height: size,
              borderRadius: size / 2,
              backgroundColor: T.surfaceHover,
              borderColor: T.surface,
            },
          ]}
        >
          <Text style={[styles.moreText, { color: T.textDim, fontSize: size * 0.42 }]}>
            +{overflow}
          </Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  stack: { flexDirection: "row", alignItems: "center" },
  ring: { borderWidth: 1.5 },
  more: { alignItems: "center", justifyContent: "center" },
  moreText: { fontFamily: FONT.semibold },
});
