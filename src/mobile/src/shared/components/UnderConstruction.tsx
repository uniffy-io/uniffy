import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { DomainHeader } from "@shared/components/DomainHeader";
import { DOMAIN_ICON } from "@shared/mentions/ReferenceChip";
import { useTheme } from "@shared/hooks/useTheme";
import { FONT } from "@theme/typography";
import type { Domain } from "@core/types";

type UnderConstructionProps = {
  title: string;
  icon: Domain;
};

// Temporary placeholder for domains whose screens exist but are not ready to
// ship. The domain keeps its carousel icon and header identity; only the body
// is stubbed out. Swap the route back to the real list screen when it lands.
export function UnderConstruction({ title, icon }: UnderConstructionProps) {
  const T = useTheme();
  const Icon = DOMAIN_ICON[icon];

  return (
    <View style={[styles.container, { backgroundColor: T.pageBg }]}>
      <DomainHeader title={title} color={T.accent} icon={icon} />
      <View style={styles.body}>
        {Icon && (
          <View style={[styles.iconWrap, { backgroundColor: T.accentSoft }]}>
            <Icon size={40} color={T.accent} weight="duotone" />
          </View>
        )}
        <Text style={[styles.message, { color: T.textBright }]}>
          This feature is under construction
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  body: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 20,
    paddingHorizontal: 32,
  },
  iconWrap: {
    width: 88,
    height: 88,
    borderRadius: 24,
    alignItems: "center",
    justifyContent: "center",
  },
  message: {
    fontSize: 17,
    fontFamily: FONT.semibold,
    textAlign: "center",
  },
});
