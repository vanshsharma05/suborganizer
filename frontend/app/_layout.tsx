import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect, useState } from 'react';
import { LogBox } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { enableFreeze } from 'react-native-screens';
import { StatusBar } from 'expo-status-bar';

import { AuthProvider } from '@/src/auth-context';
import { PurchaseProvider } from '@/src/purchases';
import { AnimatedSplash } from '@/src/animated-splash';
import { theme } from '@/src/theme';

LogBox.ignoreAllLogs(true);

/**
 * Stop rendering screens that are off-screen.
 *
 * All three tabs stay mounted for the life of the session, so without this every
 * context change — a refreshed subscription list, the exchange rate landing —
 * re-rendered Subs and Savings while the user was looking at Home, and their
 * animated children with them. Freezing means only the visible screen does work.
 */
enableFreeze(true);

// Held open only until this component mounts, so the native splash hands over
// to AnimatedSplash — which is pixel-matched to it — with no flash of blank
// screen between the two.
SplashScreen.preventAutoHideAsync().catch(() => {
  // Already hidden, or the module is unavailable. Nothing to recover from: the
  // app renders either way, and the handoff is cosmetic.
});

export default function RootLayout() {
  const [splashDone, setSplashDone] = useState(false);

  useEffect(() => {
    // Icon fonts ship inside the binary via react-native-vector-icons
    // autolinking, so there is nothing to load and nothing to wait for. This
    // used to await a CDN download that only Expo Go ever needed, which meant a
    // cold start could stall on someone else's uptime.
    SplashScreen.hideAsync().catch(() => {});
  }, []);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <AuthProvider>
          {/* Inside AuthProvider: entitlements are partly the server's answer,
              so this needs a user before it can settle. It never blocks render
              — screens see `ready: false` and simply hold their buy buttons. */}
          <PurchaseProvider>
            {/* The launch animation fills the screen with the coral gradient, so
                light status-bar content stays legible until it clears. */}
            <StatusBar style={splashDone ? 'dark' : 'light'} />
            <Stack
              screenOptions={{
                headerShown: false,
                contentStyle: { backgroundColor: theme.color.surface },
                animation: 'fade',
              }}
            />
            {/* Rendered after <Stack> so it overlays the app, and unmounted for
                good once the animation finishes. */}
            {!splashDone && <AnimatedSplash onFinish={() => setSplashDone(true)} />}
          </PurchaseProvider>
        </AuthProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
