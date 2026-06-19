import {
  Inter_300Light,
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
} from "@expo-google-fonts/inter";
import { Tangerine_700Bold } from "@expo-google-fonts/tangerine";
import { useFonts } from "@expo-google-fonts/inter";
import { QueryClientProvider } from "@tanstack/react-query";
import { Stack, usePathname, useRouter, useSegments } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import React, { useEffect, useRef } from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { View, StyleSheet, BackHandler, ActivityIndicator, Platform } from "react-native";
import { StatusBar } from "expo-status-bar";
import * as NavigationBar from "expo-navigation-bar";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { queryClient } from "@/lib/query-client";
import { UniffyProvider, useUniffy } from "@/context/uniffy-context";
import { AuthProvider, useAuth } from "@/context/auth-context";
import { ThemeProvider } from "@/context/theme-context";
import { useTheme } from "@/hooks/useTheme";
import { TopNav } from "@/components/TopNav";
import { BottomNav } from "@/components/BottomNav";
import { AtFab } from "@/components/AtFab";
import { AtOverlay } from "@/components/AtOverlay";

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
  const { returnToAt, openAt, atOpen, closeAt } = useUniffy();
  const { isAuthenticated, organizationId } = useAuth();
  const pathname = usePathname();
  const prevPathnameRef = useRef(pathname);

  const showAppChrome = isAuthenticated && !!organizationId;

  // Set Android system navigation bar to match theme
  useEffect(() => {
    if (Platform.OS !== "android") return;
    NavigationBar.setButtonStyleAsync(T.isDark ? "light" : "dark").catch(() => {});
    NavigationBar.setBackgroundColorAsync(T.isDark ? "#0D0E11" : "#F1F3F5").catch(() => {});
  }, [T.isDark]);

  // Hardware back button: close the @ overlay if open, otherwise navigate back normally
  useEffect(() => {
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
      {showAppChrome && <TopNav />}
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
      {showAppChrome && <BottomNav />}
      {showAppChrome && <AtFab />}
      {showAppChrome && <AtOverlay />}
    </View>
  );
}

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    Inter_300Light,
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
    Tangerine_700Bold,
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
                <ThemeProvider>
                  <UniffyProvider>
                    <AuthGate>
                      <RootLayoutNav />
                    </AuthGate>
                  </UniffyProvider>
                </ThemeProvider>
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
    backgroundColor: "#09090b",
    alignItems: "center",
    justifyContent: "center",
  },
});
