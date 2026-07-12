import {
  Poppins_300Light,
  Poppins_400Regular,
  Poppins_500Medium,
  Poppins_600SemiBold,
  Poppins_700Bold,
  useFonts,
} from "@expo-google-fonts/poppins";
import { QueryClientProvider } from "@tanstack/react-query";
import { Stack, usePathname, useRouter, useSegments } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import React, { useEffect, useRef } from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { SafeAreaProvider, useSafeAreaInsets } from "react-native-safe-area-context";
import { View, StyleSheet, BackHandler, ActivityIndicator, Platform } from "react-native";
import { StatusBar } from "expo-status-bar";
import * as NavigationBar from "expo-navigation-bar";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { queryClient } from "@/lib/query-client";
import { UniffyProvider, useUniffy } from "@/context/uniffy-context";
import { AuthProvider, useAuth } from "@/context/auth-context";
import { usePresenceHeartbeat } from "@/hooks/usePresence";
import { CallProvider } from "@/context/call-context";
import { ThemeProvider } from "@/context/theme-context";
import { useTheme } from "@/hooks/useTheme";
import { BottomNav, BOTTOM_BAR_CONTENT_HEIGHT, bottomBarPadding } from "@/components/BottomNav";
import { KeyboardSpacer } from "@/components/KeyboardSpacer";
import { AtOverlay } from "@/components/AtOverlay";
import { CallDock } from "@/components/calls/CallDock";
import { CallScreen } from "@/components/calls/CallScreen";
import { IncomingCallBanner } from "@/components/calls/IncomingCallBanner";
import { CallEndedNotice } from "@/components/calls/CallEndedNotice";
import { LoginSplash } from "@/components/LoginSplash";
import { BRAND } from "@/constants/theme";

SplashScreen.preventAutoHideAsync();

function AuthGate({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isRehydrating, organizationId, holdNavigation } = useAuth();
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    if (isRehydrating || holdNavigation) return;

    const currentSegment = segments[0] as string;
    const inAuth = currentSegment === "auth";
    const inSelectOrg = currentSegment === "select-org";

    if (!isAuthenticated) {
      if (!inAuth) {
        router.replace("/auth" as any);
      }
    } else if (!organizationId) {
      if (!inSelectOrg) {
        router.replace("/select-org" as any);
      }
    } else {
      if (inAuth || inSelectOrg) {
        router.replace("/");
      }
    }
  }, [isAuthenticated, isRehydrating, organizationId, holdNavigation, segments]);

  if (isRehydrating) {
    return (
      <View style={styles.loadingScreen}>
        <ActivityIndicator color="#ffffff" size="large" />
      </View>
    );
  }

  return <>{children}</>;
}

function RootLayoutNav() {
  const T = useTheme();
  const insets = useSafeAreaInsets();
  const { returnToAt, openAt, atOpen, closeAt } = useUniffy();
  const {
    isAuthenticated,
    organizationId,
    loginSplashVisible,
    setLoginSplashVisible,
    setHoldNavigation,
  } = useAuth();
  const pathname = usePathname();
  const prevPathnameRef = useRef(pathname);

  usePresenceHeartbeat();

  const showAppChrome = isAuthenticated && !!organizationId;
  const barSpace = BOTTOM_BAR_CONTENT_HEIGHT + bottomBarPadding(insets.bottom);

  // Set Android system navigation bar to match theme
  useEffect(() => {
    if (Platform.OS !== "android") return;
    NavigationBar.setButtonStyleAsync(T.isDark ? "light" : "dark").catch(() => {});
    NavigationBar.setBackgroundColorAsync(T.isDark ? BRAND.midnight : BRAND.white).catch(() => {});
  }, [T.isDark]);

  // Hardware back button: close the @ overlay if open, otherwise navigate back normally
  useEffect(() => {
    if (Platform.OS === "web") return;
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      if (atOpen) {
        closeAt();
        return true;
      }
      return false;
    });
    return () => subscription.remove();
  }, [atOpen, closeAt]);

  useEffect(() => {
    const prevDepth = prevPathnameRef.current.split("/").filter(Boolean).length;
    const currDepth = pathname.split("/").filter(Boolean).length;
    prevPathnameRef.current = pathname;
    if (currDepth < prevDepth && returnToAt) {
      openAt();
    }
  }, [pathname, returnToAt, openAt]);

  return (
    <View style={[styles.root, { backgroundColor: T.pageBg }]}>
      <StatusBar style={T.isDark ? "light" : "dark"} />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: showAppChrome ? T.pageBg : "transparent" },
        }}
      >
        <Stack.Screen name="auth" options={{ headerShown: false, animation: "fade" }} />
        <Stack.Screen name="accept-invite" options={{ headerShown: false, animation: "fade" }} />
        <Stack.Screen name="enroll-mfa" options={{ headerShown: false, animation: "fade" }} />
        <Stack.Screen name="select-org" options={{ headerShown: false, animation: "fade" }} />
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="notes/index" />
        <Stack.Screen name="notes/[id]" />
        <Stack.Screen name="notes/edit" />
        <Stack.Screen name="files/index" />
        <Stack.Screen name="files/[id]" />
        <Stack.Screen name="files/trash" />
        <Stack.Screen name="chat/index" />
        <Stack.Screen name="chat/[id]" />
        <Stack.Screen name="chat/create" />
        <Stack.Screen name="agents/index" />
        <Stack.Screen name="calendar/index" />
        <Stack.Screen name="calendar/[id]" />
        <Stack.Screen name="projects/index" />
        <Stack.Screen name="projects/[id]" />
        <Stack.Screen name="projects/task/[id]" />
        <Stack.Screen name="search/index" />
        <Stack.Screen name="bookmarks/index" />
        <Stack.Screen name="tags/index" />
        <Stack.Screen name="tags/[id]" />
        <Stack.Screen name="notifications/index" />
        <Stack.Screen name="you/index" />
        <Stack.Screen name="you/sessions" />
        <Stack.Screen name="you/appearance" />
        <Stack.Screen name="you/notifications" />
        <Stack.Screen name="you/security" />
      </Stack>
      {showAppChrome && <KeyboardSpacer minHeight={barSpace} />}
      {showAppChrome && <AtOverlay />}
      {showAppChrome && <CallDock />}
      {showAppChrome && <BottomNav />}
      {showAppChrome && <CallScreen />}
      {showAppChrome && <IncomingCallBanner />}
      {showAppChrome && <CallEndedNotice />}
      {loginSplashVisible && (
        <LoginSplash
          onReveal={() => setHoldNavigation(false)}
          onFinished={() => setLoginSplashVisible(false)}
        />
      )}
    </View>
  );
}

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    Poppins_300Light,
    Poppins_400Regular,
    Poppins_500Medium,
    Poppins_600SemiBold,
    Poppins_700Bold,
  });

  useEffect(() => {
    if (fontsLoaded || fontError) {
      SplashScreen.hideAsync();
    }
  }, [fontsLoaded, fontError]);

  if (!fontsLoaded && !fontError) return null;

  return (
    <ErrorBoundary>
      <SafeAreaProvider>
        <QueryClientProvider client={queryClient}>
          <GestureHandlerRootView style={{ flex: 1 }}>
            <KeyboardProvider>
              <AuthProvider>
                <CallProvider>
                  <ThemeProvider>
                    <UniffyProvider>
                      <AuthGate>
                        <RootLayoutNav />
                      </AuthGate>
                    </UniffyProvider>
                  </ThemeProvider>
                </CallProvider>
              </AuthProvider>
            </KeyboardProvider>
          </GestureHandlerRootView>
        </QueryClientProvider>
      </SafeAreaProvider>
    </ErrorBoundary>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  loadingScreen: {
    flex: 1,
    backgroundColor: BRAND.midnight,
    alignItems: "center",
    justifyContent: "center",
  },
});
