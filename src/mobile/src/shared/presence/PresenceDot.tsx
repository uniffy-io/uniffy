import React from "react";
import { View, StyleSheet } from "react-native";
import { useTheme } from "@shared/hooks/useTheme";

type PresenceDotProps = {
  status: string;
  size?: number;
  /** Color of the ring separating the dot from whatever it overlaps. */
  ringColor?: string;
};

/** Positioned absolute on a relative parent, bottom-right like the web dot. */
export function PresenceDot({ status, size = 11, ringColor }: PresenceDotProps) {
  const T = useTheme();
  const ring = ringColor ?? T.pageBg;
  const inner = size - 4;

  let fill: React.ReactNode;
  if (status === "online" || status === "away") {
    fill = (
      <View
        style={{
          width: inner,
          height: inner,
          borderRadius: inner / 2,
          backgroundColor: status === "online" ? T.green : T.yellow,
        }}
      />
    );
  } else if (status === "dnd") {
    fill = (
      <View
        style={[
          styles.center,
          { width: inner, height: inner, borderRadius: inner / 2, backgroundColor: T.red },
        ]}
      >
        <View
          style={{ width: inner * 0.6, height: 1.5, borderRadius: 1, backgroundColor: "#ffffff" }}
        />
      </View>
    );
  } else {
    fill = (
      <View
        style={{
          width: inner,
          height: inner,
          borderRadius: inner / 2,
          borderWidth: 1.5,
          borderColor: T.textDim,
        }}
      />
    );
  }

  return (
    <View
      style={[
        styles.center,
        styles.anchor,
        { width: size, height: size, borderRadius: size / 2, backgroundColor: ring },
      ]}
      pointerEvents="none"
    >
      {fill}
    </View>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: "center", justifyContent: "center" },
  anchor: { position: "absolute", bottom: -1, right: -1 },
});
