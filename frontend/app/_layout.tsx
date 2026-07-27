import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { useEffect, useState } from "react";
import { LogBox } from "react-native";
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';

import { useIconFonts } from "@/src/hooks/use-icon-fonts";
import { AuthProvider } from "@/src/auth-context";
import { AnimatedSplash } from "@/src/animated-splash";

LogBox.ignoreAllLogs(true);

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const [loaded, error] = useIconFonts();
  const [splashDone, setSplashDone] = useState(false);

  useEffect(() => {
    if (loaded || error) {
      SplashScreen.hideAsync();
    }
  }, [loaded, error]);

  if (!loaded && !error) return null;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <AuthProvider>
          {/* The launch animation fills the screen with the coral gradient, so
              light status-bar content stays legible until it clears. */}
          <StatusBar style={splashDone ? 'dark' : 'light'} />
          <Stack
            screenOptions={{
              headerShown: false,
              contentStyle: { backgroundColor: '#FDFBF7' },
              animation: 'fade',
            }}
          />
          {/* Rendered after <Stack> so it overlays the app, and unmounted for
              good once the animation finishes. */}
          {!splashDone && <AnimatedSplash onFinish={() => setSplashDone(true)} />}
        </AuthProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
