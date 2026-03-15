import React, { useEffect, useRef } from "react";
import { View, Text, Image, Animated, StyleSheet } from "react-native";
import { LinearGradient } from "expo-linear-gradient";

const LINES = [
  "One app to hold them all\u00A0\u00A0",
  "One app to find them\u00A0\u00A0",
  "One app to bring them all\u00A0\u00A0",
  "and in the chaos, bind them",
];

// Timing (seconds) matching the HTML animation
// Total cycle: 19s
// Lines fade in staggered at 2s intervals, hold, fade out together
// Logo fades in after lines fade, holds, fades out
const LINE_FADE_IN_DURATION = 2000;
const LINE_STAGGER = 2000;
const LINES_HOLD_UNTIL = 9000;
const LINES_FADE_OUT_END = 11000;
const LOGO_FADE_IN_START = 11000;
const LOGO_FADE_IN_END = 12000;
const LOGO_HOLD_UNTIL = 13000;
const LOGO_FADE_OUT_END = 13500;

type Props = {
  onFinished: () => void;
};

export function OneRingAnimation({ onFinished }: Props) {
  const lineAnims = useRef(LINES.map(() => new Animated.Value(0))).current;
  const logoAnim = useRef(new Animated.Value(0)).current;
  const pulseAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    // Fire pulse loop for the glow effect
    const pulseLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: 3000,
          useNativeDriver: false,
        }),
        Animated.timing(pulseAnim, {
          toValue: 0,
          duration: 3000,
          useNativeDriver: false,
        }),
      ]),
    );
    pulseLoop.start();

    // Line animations: each fades in staggered, holds, then all fade out
    const lineSequences = LINES.map((_, i) => {
      const fadeInStart = i * LINE_STAGGER;
      const fadeOutStart = LINES_HOLD_UNTIL;
      const fadeOutEnd = LINES_FADE_OUT_END;

      return Animated.sequence([
        Animated.delay(fadeInStart),
        Animated.timing(lineAnims[i], {
          toValue: 1,
          duration: LINE_FADE_IN_DURATION,
          useNativeDriver: true,
        }),
        // Hold until fade out time
        Animated.delay(fadeOutStart - (fadeInStart + LINE_FADE_IN_DURATION)),
        Animated.timing(lineAnims[i], {
          toValue: 0,
          duration: fadeOutEnd - fadeOutStart,
          useNativeDriver: true,
        }),
      ]);
    });

    // Logo animation: fade in, hold, fade out
    const logoSequence = Animated.sequence([
      Animated.delay(LOGO_FADE_IN_START),
      Animated.timing(logoAnim, {
        toValue: 1,
        duration: LOGO_FADE_IN_END - LOGO_FADE_IN_START,
        useNativeDriver: true,
      }),
      Animated.delay(LOGO_HOLD_UNTIL - LOGO_FADE_IN_END),
      Animated.timing(logoAnim, {
        toValue: 0,
        duration: LOGO_FADE_OUT_END - LOGO_HOLD_UNTIL,
        useNativeDriver: true,
      }),
    ]);

    Animated.parallel([...lineSequences, logoSequence]).start(() => {
      pulseLoop.stop();
      onFinished();
    });

    return () => {
      pulseLoop.stop();
    };
  }, []);

  const glowColor = pulseAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ["rgba(255, 204, 0, 0.6)", "rgba(255, 100, 0, 0.8)"],
  });

  return (
    <View style={styles.container}>
      <LinearGradient
        colors={["#050505", "#1a1a1a", "#000000"]}
        style={StyleSheet.absoluteFill}
        start={{ x: 0.5, y: 0 }}
        end={{ x: 0.5, y: 1 }}
      />

      {/* Inscription lines */}
      <View style={styles.inscription}>
        {LINES.map((line, i) => (
          <Animated.Text key={i} style={[styles.line, { opacity: lineAnims[i] }]}>
            {line}
          </Animated.Text>
        ))}
      </View>

      {/* Logo + text */}
      <Animated.View style={[styles.logoWrapper, { opacity: logoAnim }]}>
        <Image
          source={require("../assets/images/uniffy-logo.png")}
          style={styles.logo}
          resizeMode="contain"
        />
        <Text style={styles.uniffyText}>uniffy</Text>
      </Animated.View>

      {/* Attribution */}
      <Animated.Text style={[styles.attribution, { opacity: lineAnims[0] }]}>
        inspired by The Lord of the Rings
      </Animated.Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 100,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#050505",
  },
  inscription: {
    position: "absolute",
    alignItems: "center",
    gap: 24,
  },
  line: {
    fontSize: 38,
    fontFamily: "Tangerine_700Bold",
    color: "#ffe6b3",
    textAlign: "center",
    letterSpacing: 2,
    lineHeight: 52,
    textShadowColor: "rgba(255, 102, 0, 0.7)",
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 20,
  },
  logoWrapper: {
    position: "absolute",
    alignItems: "center",
    justifyContent: "center",
  },
  logo: {
    width: 100,
    height: 100,
    marginBottom: 10,
  },
  uniffyText: {
    fontFamily: "Inter_700Bold",
    fontSize: 32,
    color: "#ffffff",
    letterSpacing: -0.5,
  },
  attribution: {
    position: "absolute",
    bottom: 48,
    fontFamily: "Inter_400Regular",
    fontSize: 11,
    color: "rgba(255,255,255,0.25)",
    letterSpacing: 0.5,
  },
});
