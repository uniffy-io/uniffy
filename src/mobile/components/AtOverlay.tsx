import React, { useRef, useEffect } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  FlatList,
  StyleSheet,
  Animated,
  Keyboard,
  Platform,
  ActivityIndicator,
} from "react-native";
import { X, MagnifyingGlass, ArrowRight } from "phosphor-react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router } from "expo-router";
import { useUniffy } from "@/context/uniffy-context";
import { useSearch } from "@/hooks/useSearch";
import { useTheme } from "@/hooks/useTheme";
import { BOTTOM_NAV_HEIGHT } from "@/constants/theme";
import { DOMAIN_ICON, getDomainColor, getDomainSoftColor } from "@/components/ReferenceChip";
import { TOP_NAV_CONTENT_HEIGHT } from "@/components/TopNav";
import type { Domain } from "@/lib/types";
import type { SerializedSearchResult } from "@/lib/searchSerializer";

const FILTERS: { key: "all" | Domain; label: string }[] = [
  { key: "all", label: "All" },
  { key: "notes", label: "Notes" },
  { key: "files", label: "Files" },
  { key: "chat", label: "Chat" },
  { key: "calendar", label: "Cal" },
  { key: "projects", label: "Projects" },
];

export function AtOverlay() {
  const insets = useSafeAreaInsets();
  const T = useTheme();
  const {
    atOpen,
    atFromEditor,
    atPosition,
    closeAt,
    returnToAt,
    setReturnToAt,
    savedAtState,
    saveAtState,
    insertReference,
  } = useUniffy();
  const { query, setQuery, results, isLoading, activeFilter, setActiveFilter, clearResults } =
    useSearch();

  const [isMounted, setIsMounted] = React.useState(false);
  const slideAnim = useRef(new Animated.Value(0)).current;
  const inputRef = useRef<TextInput>(null);

  const topNavHeight = (Platform.OS === "web" ? 20 : insets.top) + TOP_NAV_CONTENT_HEIGHT;
  const navBottom = BOTTOM_NAV_HEIGHT + (Platform.OS === "web" ? 34 : insets.bottom);

  useEffect(() => {
    if (atOpen) {
      setIsMounted(true);
    } else {
      Keyboard.dismiss();
      Animated.timing(slideAnim, {
        toValue: 0,
        duration: 220,
        useNativeDriver: Platform.OS !== "web",
      }).start(() => setIsMounted(false));
    }
  }, [atOpen]);

  useEffect(() => {
    if (atOpen && isMounted) {
      slideAnim.setValue(0);
      if (returnToAt && savedAtState) {
        setQuery(savedAtState.query);
        setActiveFilter(savedAtState.filter);
        setReturnToAt(false);
      } else if (!returnToAt) {
        clearResults();
      }
      Animated.spring(slideAnim, {
        toValue: 1,
        useNativeDriver: Platform.OS !== "web",
        tension: 65,
        friction: 11,
      }).start();
    }
  }, [isMounted, atOpen]);

  const translateY = slideAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [100, 0],
  });
  const opacity = slideAnim.interpolate({ inputRange: [0, 1], outputRange: [0, 1] });

  if (!isMounted) return null;

  const handleNavigate = (item: SerializedSearchResult) => {
    saveAtState({ query, filter: activeFilter });
    setReturnToAt(true);
    closeAt();
    if (item.route) {
      router.push(item.route as any);
    }
  };

  const handleReference = (item: SerializedSearchResult) => {
    if (!item.domain) return;
    insertReference({ id: item.id, label: item.title, domain: item.domain });
    closeAt();
  };

  return (
    <Animated.View
      style={[
        styles.overlay,
        { top: topNavHeight, backgroundColor: T.pageBg, opacity, transform: [{ translateY }] },
      ]}
    >
      <View style={[styles.topBar, { paddingTop: 12, borderBottomColor: T.border }]}>
        <View style={[styles.searchRow, { backgroundColor: T.surface, borderColor: T.border }]}>
          <MagnifyingGlass size={16} color={T.textDim} weight="bold" />
          <TextInput
            ref={inputRef}
            style={[styles.input, { color: T.textBright }]}
            placeholder="Search everything..."
            placeholderTextColor={T.textDim}
            value={query}
            onChangeText={setQuery}
            returnKeyType="search"
            autoCapitalize="none"
          />
          {query.length > 0 && (
            <TouchableOpacity onPress={clearResults}>
              <X size={14} color={T.textDim} weight="duotone" />
            </TouchableOpacity>
          )}
        </View>
        {atPosition === "fab" && <View style={styles.closeButtonSpacer} />}
      </View>

      {query.length > 0 && (
        <View style={[styles.resultsHeader, { borderBottomColor: T.border }]}>
          <Text style={[styles.resultsLabel, { color: T.textDim }]}>
            {`RESULTS FOR "${query.toUpperCase()}"`}
          </Text>
        </View>
      )}

      <View style={[styles.filterBar, { borderBottomColor: T.border }]}>
        <FlatList
          horizontal
          data={FILTERS}
          keyExtractor={(f) => f.key}
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.filterContent}
          renderItem={({ item: f }) => {
            const active = f.key === activeFilter;
            const color = f.key === "all" ? T.accent : getDomainColor(f.key as Domain);
            return (
              <TouchableOpacity
                onPress={() => setActiveFilter(f.key)}
                style={[
                  styles.filterPill,
                  {
                    backgroundColor: active ? color + "22" : T.surface,
                    borderColor: active ? color : T.border,
                  },
                ]}
              >
                <Text style={[styles.filterText, { color: active ? color : T.textDim }]}>
                  {f.label}
                </Text>
              </TouchableOpacity>
            );
          }}
        />
      </View>

      <FlatList
        data={results}
        keyExtractor={(item) => item.urn}
        contentContainerStyle={{ paddingBottom: navBottom + 16 }}
        keyboardShouldPersistTaps="handled"
        renderItem={({ item }) => {
          const domain = item.domain as Domain;
          const IconComponent = DOMAIN_ICON[domain];
          const domainColor = getDomainColor(domain);
          const softColor = getDomainSoftColor(domain);
          return (
            <View style={[styles.resultRow, { borderBottomColor: T.border }]}>
              <View style={[styles.domainIcon, { backgroundColor: softColor }]}>
                <IconComponent size={16} color={domainColor} weight="bold" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.resultTitle, { color: T.textBright }]}>{item.title}</Text>
                <View style={styles.resultMeta}>
                  <View style={[styles.domainBadge, { backgroundColor: softColor }]}>
                    <Text style={[styles.domainBadgeText, { color: domainColor }]}>
                      {domain.toUpperCase()}
                    </Text>
                  </View>
                  {item.description ? (
                    <Text style={[styles.resultSub, { color: T.textDim }]} numberOfLines={1}>
                      {item.description}
                    </Text>
                  ) : null}
                </View>
              </View>
              <View style={styles.actionButtons}>
                {atFromEditor && (
                  <TouchableOpacity
                    style={[
                      styles.actionBtn,
                      { backgroundColor: T.accent + "22", borderColor: T.accent + "55" },
                    ]}
                    onPress={() => handleReference(item)}
                    activeOpacity={0.7}
                  >
                    <Text style={[styles.actionBtnAt, { color: T.accent }]}>@</Text>
                  </TouchableOpacity>
                )}
                <TouchableOpacity
                  style={[styles.actionBtn, { backgroundColor: T.surface, borderColor: T.border }]}
                  onPress={() => handleNavigate(item)}
                  activeOpacity={0.7}
                >
                  <ArrowRight size={13} color={T.textDim} weight="bold" />
                </TouchableOpacity>
              </View>
            </View>
          );
        }}
        ListEmptyComponent={
          isLoading ? (
            <View style={styles.empty}>
              <ActivityIndicator color={T.accent} />
            </View>
          ) : (
            <View style={styles.empty}>
              <Text style={[styles.emptyText, { color: T.textDim }]}>
                {query.trim() ? "No results found" : "Type to search..."}
              </Text>
            </View>
          )
        }
      />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 250,
  },
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingLeft: 16,
    paddingRight: 16,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  searchRow: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 12,
    height: 42,
  },
  closeButtonSpacer: {
    width: 36,
    height: 36,
    flexShrink: 0,
  },
  input: {
    flex: 1,
    fontSize: 15,
    fontFamily: "Inter_400Regular",
  },
  resultsHeader: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  resultsLabel: {
    fontSize: 11,
    fontFamily: "Inter_600SemiBold",
    letterSpacing: 0.8,
  },
  filterBar: {
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  filterContent: {
    paddingHorizontal: 16,
    gap: 8,
    paddingVertical: 10,
    flexDirection: "row",
  },
  filterPill: {
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 20,
    borderWidth: 1,
  },
  filterText: {
    fontSize: 12,
    fontFamily: "Inter_500Medium",
  },
  resultRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  domainIcon: {
    width: 38,
    height: 38,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  resultTitle: {
    fontSize: 14,
    fontFamily: "Inter_500Medium",
    marginBottom: 4,
  },
  resultMeta: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  domainBadge: {
    paddingHorizontal: 5,
    paddingVertical: 2,
    borderRadius: 4,
  },
  domainBadgeText: {
    fontSize: 9,
    fontFamily: "Inter_700Bold",
    letterSpacing: 0.4,
  },
  resultSub: {
    fontSize: 11,
    fontFamily: "Inter_400Regular",
    flex: 1,
  },
  actionButtons: {
    flexDirection: "row",
    gap: 7,
  },
  actionBtn: {
    width: 34,
    height: 34,
    borderRadius: 9,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  actionBtnAt: {
    fontSize: 15,
    fontFamily: "Inter_700Bold",
    lineHeight: 18,
  },
  empty: {
    padding: 40,
    alignItems: "center",
  },
  emptyText: {
    fontSize: 15,
    fontFamily: "Inter_400Regular",
  },
});
