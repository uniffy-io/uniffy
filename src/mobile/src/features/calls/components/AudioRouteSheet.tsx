import React from "react";
import { Text, StyleSheet, Platform } from "react-native";
import { Bluetooth, DotsThree, Headphones, Phone, SpeakerHigh } from "phosphor-react-native";
import { showAudioRoutePicker } from "@features/calls/livekit";
import { useAudioOutputs } from "@features/calls/useAudioOutputs";
import { BottomSheet } from "@shared/components/BottomSheet";
import { SheetHeader } from "@shared/components/SheetHeader";
import { SheetRow } from "@shared/components/SheetRow";
import { useTheme } from "@shared/hooks/useTheme";
import { FONT } from "@theme/typography";

/**
 * A component rather than a lookup returning one: picking the component during
 * render gives it a fresh identity on every route change, which remounts the icon.
 */
export function AudioRouteIcon({
  routeId,
  size,
  color,
}: {
  routeId: string | undefined;
  size: number;
  color: string;
}) {
  switch (routeId) {
    case "bluetooth":
      return <Bluetooth size={size} color={color} weight="fill" />;
    case "headset":
      return <Headphones size={size} color={color} weight="fill" />;
    case "earpiece":
    case "default":
      return <Phone size={size} color={color} weight="fill" />;
    default:
      return <SpeakerHigh size={size} color={color} weight="fill" />;
  }
}

export function AudioRouteSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const T = useTheme();
  const { outputs, selected, select } = useAudioOutputs(visible);

  return (
    <BottomSheet visible={visible} onClose={onClose}>
      <SheetHeader title="Audio output" />
      {outputs.length === 0 ? (
        <Text style={[styles.empty, { color: T.textDim }]}>
          No audio outputs to choose from right now
        </Text>
      ) : null}
      {outputs.map((route) => (
        <SheetRow
          key={route.id}
          leading={<AudioRouteIcon routeId={route.id} size={18} color={T.textDim} />}
          title={route.label}
          selected={selected === route.id}
          onPress={() => {
            select(route.id);
            onClose();
          }}
        />
      ))}
      {/* iOS only ever reports two routes of its own; headsets, Bluetooth and
          AirPlay are chosen through the system picker. */}
      {Platform.OS === "ios" ? (
        <SheetRow
          leading={<DotsThree size={18} color={T.textDim} weight="bold" />}
          title="More outputs"
          subtitle="AirPods, Bluetooth, AirPlay"
          onPress={() => {
            onClose();
            void showAudioRoutePicker().catch(() => {});
          }}
        />
      ) : null}
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  empty: { fontSize: 13, fontFamily: FONT.regular, paddingHorizontal: 16, paddingVertical: 14 },
});
