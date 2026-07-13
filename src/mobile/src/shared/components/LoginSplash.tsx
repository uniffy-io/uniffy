import React, { useEffect, useRef } from "react";
import { Text, Image, Animated, Platform, StyleSheet } from "react-native";
import { BRAND } from "@theme/theme";
import { FONT } from "@theme/typography";

const COVER_IN = 250;
const LOGO_DELAY = 350;
const LOGO_FADE_IN = 700;
const HOLD = 1000;
const ROUTE_SETTLE = 350;
const REVEAL = 500;

type Props = {
  onReveal: () => void;
  onFinished: () => void;
};

// Mounted at the layout level, above the router, so it survives the route
// swap: the cover goes opaque, onReveal lets navigation happen underneath,
// then the cover dissolves over the destination screen.
export function LoginSplash({ onReveal, onFinished }: Props) {
  const coverOpacity = useRef(new Animated.Value(0)).current;
  const logoOpacity = useRef(new Animated.Value(0)).current;
  // Refs keep the latest callbacks without restarting the sequence on re-render.
  const onRevealRef = useRef(onReveal);
  const onFinishedRef = useRef(onFinished);

  useEffect(() => {
    onRevealRef.current = onReveal;
    onFinishedRef.current = onFinished;
  }, [onReveal, onFinished]);

  useEffect(() => {
    const native = Platform.OS !== "web";
    Animated.sequence([
      Animated.timing(coverOpacity, { toValue: 1, duration: COVER_IN, useNativeDriver: native }),
      Animated.delay(LOGO_DELAY),
      Animated.timing(logoOpacity, {
        toValue: 1,
        duration: LOGO_FADE_IN,
        useNativeDriver: native,
      }),
      Animated.delay(HOLD),
    ]).start(({ finished }) => {
      if (!finished) return;
      onRevealRef.current();
      Animated.sequence([
        Animated.delay(ROUTE_SETTLE),
        Animated.timing(coverOpacity, { toValue: 0, duration: REVEAL, useNativeDriver: native }),
      ]).start(({ finished: revealed }) => {
        if (revealed) onFinishedRef.current();
      });
    });
  }, [coverOpacity, logoOpacity]);

  return (
    <Animated.View style={[styles.container, { opacity: coverOpacity }]}>
      <Animated.View style={[styles.logoWrapper, { opacity: logoOpacity }]}>
        <Image
          source={require("../../../assets/images/uniffy-logo.png")}
          style={styles.logo}
          resizeMode="contain"
        />
        <Text style={styles.wordmark}>uniffy</Text>
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 300,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: BRAND.midnight,
  },
  logoWrapper: {
    alignItems: "center",
  },
  logo: {
    width: 96,
    height: 96,
    marginBottom: 12,
  },
  wordmark: {
    fontFamily: FONT.bold,
    fontSize: 32,
    color: BRAND.white,
    letterSpacing: -0.5,
  },
});
