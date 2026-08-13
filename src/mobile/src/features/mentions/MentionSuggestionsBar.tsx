import React from "react";
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
} from "react-native";
import { User, UsersThree, Robot } from "phosphor-react-native";
import { SearchResultType } from "@uniffy/proto/search/v1/search_pb";
import { DOMAIN_ICON } from "@shared/mentions/ReferenceChip";
import { useTheme } from "@shared/hooks/useTheme";
import { FONT } from "@theme/typography";
import type { Domain } from "@core/types";
import type { SerializedSearchResult } from "@features/search/searchSerializer";

const ROW_HEIGHT = 46;
const MAX_VISIBLE_ROWS = 4.5;

const PEOPLE_META: Partial<
  Record<SearchResultType, { label: string; Icon: React.ComponentType<any> }>
> = {
  [SearchResultType.USER]: { label: "User", Icon: User },
  [SearchResultType.AGENT]: { label: "Agent", Icon: Robot },
  [SearchResultType.TEAM]: { label: "Team", Icon: UsersThree },
};

function typeLabel(item: SerializedSearchResult): string {
  const people = PEOPLE_META[item.type];
  if (people) return people.label;
  return item.domain ? item.domain.charAt(0).toUpperCase() + item.domain.slice(1) : "";
}

/** Inline `@` typeahead rendered as a sibling above the composer (never an
 *  absolute overlay: inset-positioned views get flow-laid on iOS 26 Fabric). */
export function MentionSuggestionsBar({
  results,
  isLoading,
  onPick,
}: {
  results: SerializedSearchResult[];
  isLoading: boolean;
  onPick: (item: SerializedSearchResult) => void;
}) {
  const T = useTheme();

  if (!isLoading && results.length === 0) return null;

  return (
    <View
      style={[styles.container, { backgroundColor: T.surface, borderColor: T.border }]}
      accessibilityRole="menu"
    >
      {results.length === 0 ? (
        <View style={styles.loading}>
          <ActivityIndicator size="small" color={T.accent} />
        </View>
      ) : (
        <ScrollView
          style={{ maxHeight: ROW_HEIGHT * MAX_VISIBLE_ROWS }}
          keyboardShouldPersistTaps="always"
        >
          {results.map((item) => {
            const people = PEOPLE_META[item.type];
            const IconComponent =
              people?.Icon ?? (item.domain ? DOMAIN_ICON[item.domain as Domain] : User);
            const iconColor = people ? T.accent : T.textDim;
            return (
              <TouchableOpacity
                key={item.urn}
                style={[styles.row, { borderBottomColor: T.border }]}
                onPress={() => onPick(item)}
                activeOpacity={0.6}
                accessibilityRole="menuitem"
                accessibilityLabel={`Mention ${typeLabel(item)}: ${item.title}`}
              >
                <View
                  style={[
                    styles.icon,
                    { backgroundColor: people ? T.accentSoft : T.bg, borderColor: T.border },
                  ]}
                >
                  <IconComponent size={15} color={iconColor} weight={people ? "fill" : "bold"} />
                </View>
                <Text style={[styles.title, { color: T.textBright }]} numberOfLines={1}>
                  {item.title}
                </Text>
                <Text style={[styles.kind, { color: T.textDim }]}>{typeLabel(item)}</Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginHorizontal: 10,
    marginBottom: 2,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: "hidden",
  },
  loading: {
    height: ROW_HEIGHT,
    alignItems: "center",
    justifyContent: "center",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    height: ROW_HEIGHT,
    paddingHorizontal: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  icon: {
    width: 30,
    height: 30,
    borderRadius: 15,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: "center",
    justifyContent: "center",
  },
  title: {
    flex: 1,
    fontSize: 14,
    fontFamily: FONT.medium,
  },
  kind: {
    fontSize: 11,
    fontFamily: FONT.regular,
  },
});
