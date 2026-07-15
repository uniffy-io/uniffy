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
import { ErrorBoundary } from "@shared/components/ErrorBoundary";
import { queryClient } from "@core/api/query-client";
import { UniffyProvider, useUniffy } from "@core/providers/uniffy-context";
import { AuthProvider, useAuth } from "@core/providers/auth-context";
import { usePresenceHeartbeat } from "@shared/presence/usePresence";
import { CallProvider, useCall } from "@features/calls/call-context";
import { ThemeProvider } from "@core/providers/theme-context";
import { useTheme } from "@shared/hooks/useTheme";
import { BottomNav, bottomBarBlockHeight } from "@shared/components/BottomNav";
import { useUnreadNotificationCount } from "@features/notifications/useNotifications";
import { KeyboardSpacer } from "@shared/components/KeyboardSpacer";
import { AtOverlay } from "@features/mentions/AtOverlay";
import { CallIndicator } from "@features/calls/components/CallIndicator";
import { CallScreen } from "@features/calls/components/CallScreen";
import { IncomingCallBanner } from "@features/calls/components/IncomingCallBanner";
import { CallEndedNotice } from "@features/calls/components/CallEndedNotice";
import { LoginSplash } from "@shared/components/LoginSplash";
import { BRAND } from "@theme/theme";

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

function AppBottomNav() {
  const unread = useUnreadNotificationCount().data ?? 0;
  return <BottomNav unreadCount={unread} />;
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
  const { session: callSession, minimized: callMinimized, setMinimized } = useCall();

  usePresenceHeartbeat();

  const showAppChrome = isAuthenticated && !!organizationId;

  // Set Android system navigation bar to match theme
  useEffect(() => {
    if (Platform.OS !== "android") return;
    NavigationBar.setButtonStyleAsync(T.isDark ? "light" : "dark").catch(() => {});
    NavigationBar.setBackgroundColorAsync(T.isDark ? BRAND.midnight : BRAND.white).catch(() => {});
  }, [T.isDark]);

  // Hardware back button: minimize the call overlay or close the @ overlay
  // before letting navigation handle it.
  const callExpanded =
    !callMinimized &&
    (callSession.status === "connecting" ||
      callSession.status === "connected" ||
      callSession.status === "reconnecting");
  useEffect(() => {
    if (Platform.OS === "web") return;
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      if (callExpanded) {
        setMinimized(true);
        return true;
      }
      if (atOpen) {
        closeAt();
        return true;
      }
      return false;
    });
    return () => subscription.remove();
  }, [atOpen, closeAt, callExpanded, setMinimized]);

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
      {/* The negative margin slides the router content under the flow-laid
          bar so its glass has real content to refract; screens inset their
          scrollables (BOTTOM_NAV_HEIGHT + insets.bottom, or
          bottomBarBlockHeight for exact flushness) to clear the bar. While a
          call is expanded the CallScreen flow child replaces this wrapper
          (display none keeps navigation state mounted); RTCView cannot render
          in a modal and absolute overlays flow-collapse on iOS 26 Fabric. */}
      <View
        style={[
          styles.content,
          showAppChrome && { marginBottom: -bottomBarBlockHeight(insets.bottom) },
          callExpanded && styles.contentHidden,
        ]}
      >
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
      </View>
      {/* The bar is a flow child on purpose: iOS 26 Fabric keeps absolutely
          positioned shell overlays in flow layout (they steal Stack height),
          so the bar IS the reserved space. The spacer after it lifts the bar
          above the keyboard. Overlay stacking comes from sibling order, not
          zIndex - zIndex on a fully inset-positioned sibling triggers the
          same flow-layout bug. */}
      {showAppChrome && callExpanded && <CallScreen />}
      {showAppChrome && !callExpanded && <CallIndicator />}
      {showAppChrome && !callExpanded && <AppBottomNav />}
      {showAppChrome && !callExpanded && <KeyboardSpacer />}
      {showAppChrome && <AtOverlay />}
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
  content: { flex: 1 },
  contentHidden: { display: "none" },
  loadingScreen: {
    flex: 1,
    backgroundColor: BRAND.midnight,
    alignItems: "center",
    justifyContent: "center",
  },
});
