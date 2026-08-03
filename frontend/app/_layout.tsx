import { Stack, type ErrorBoundaryProps } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useCallback, useEffect, useState } from 'react';
import { LogBox, Pressable, StyleSheet, Text, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { enableFreeze } from 'react-native-screens';
import { StatusBar } from 'expo-status-bar';

import { AuthProvider, useAuth } from '@/src/auth-context';
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

/**
 * What the user sees instead of a white screen.
 *
 * Expo Router renders this in place of the whole tree when a descendant throws
 * during render. Without it an error anywhere — one malformed row, one date the
 * parser rejects — takes the app to blank with no way out but force-quitting,
 * and a force-quit relaunches straight back into whatever threw.
 *
 * Deliberately built from plain View, Text and Pressable. This is what runs when
 * the app is already broken, so it depends on nothing that could be the thing
 * that broke: no context, no animation, no shared components.
 */
export function ErrorBoundary({ error, retry }: ErrorBoundaryProps) {
  return (
    <View style={crash.root}>
      <View style={crash.mark} />
      <Text style={crash.title}>That didn&rsquo;t work</Text>
      <Text style={crash.body}>
        Something went wrong drawing this screen. Your subscriptions are saved and
        untouched — nothing has been lost.
      </Text>

      {__DEV__ && <Text style={crash.detail}>{error.message}</Text>}

      <Pressable
        onPress={retry}
        style={({ pressed }) => [crash.button, pressed && crash.buttonPressed]}
        accessibilityRole="button"
        accessibilityLabel="Try again"
      >
        <Text style={crash.buttonLabel}>Try again</Text>
      </Pressable>

      <Text style={crash.help}>
        If it keeps happening, email taskteamprosupport@gmail.com
      </Text>
    </View>
  );
}

/**
 * Holds the splash until the session restore has settled.
 *
 * Separate from RootLayout because `useAuth` needs a provider above it, and
 * RootLayout is what renders that provider.
 */
function Splash({ onFinish, onFadeStart }: { onFinish: () => void; onFadeStart: () => void }) {
  const { loading } = useAuth();
  return <AnimatedSplash ready={!loading} onFinish={onFinish} onFadeStart={onFadeStart} />;
}

export default function RootLayout() {
  const [splashDone, setSplashDone] = useState(false);
  const [brandGone, setBrandGone] = useState(false);

  useEffect(() => {
    // Icon fonts ship inside the binary via react-native-vector-icons
    // autolinking, so there is nothing to load and nothing to wait for. This
    // used to await a CDN download that only Expo Go ever needed, which meant a
    // cold start could stall on someone else's uptime.
    SplashScreen.hideAsync().catch(() => {});
  }, []);

  const handleFadeStart = useCallback(() => setBrandGone(true), []);
  const handleFinish = useCallback(() => setSplashDone(true), []);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <AuthProvider>
          {/* Inside AuthProvider: entitlements are partly the server's answer,
              so this needs a user before it can settle. It never blocks render
              — screens see `ready: false` and simply hold their buy buttons. */}
          <PurchaseProvider>
            {/* Light content while the coral gradient fills the screen, dark the
                moment it starts dissolving. Switching at the end of the fade
                instead would leave white text on a background already turned
                cream, for the length of the cross-fade. */}
            <StatusBar style={brandGone ? 'dark' : 'light'} />
            <Stack
              screenOptions={{
                headerShown: false,
                contentStyle: { backgroundColor: theme.color.surface },
                animation: 'fade',
              }}
            />
            {/* Rendered after <Stack> so it overlays the app, and unmounted for
                good once the animation finishes. */}
            {!splashDone && <Splash onFinish={handleFinish} onFadeStart={handleFadeStart} />}
          </PurchaseProvider>
        </AuthProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const crash = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: theme.color.surface,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: theme.space.xl,
  },
  mark: {
    width: 46,
    height: 46,
    borderRadius: 7,
    backgroundColor: theme.color.brand,
    transform: [{ rotate: '45deg' }],
    marginBottom: theme.space.xxl,
  },
  title: {
    ...theme.type.title2,
    color: theme.color.ink,
    textAlign: 'center',
  },
  body: {
    ...theme.type.body,
    color: theme.color.inkSoft,
    textAlign: 'center',
    marginTop: theme.space.md,
    maxWidth: 320,
  },
  detail: {
    ...theme.type.caption,
    color: theme.color.error,
    textAlign: 'center',
    marginTop: theme.space.lg,
    maxWidth: 320,
  },
  button: {
    marginTop: theme.space.xxl,
    minHeight: 52,
    justifyContent: 'center',
    paddingHorizontal: theme.space.xxl,
    borderRadius: theme.radius.pill,
    backgroundColor: theme.color.brand,
  },
  buttonPressed: { backgroundColor: theme.color.brandPrimary },
  buttonLabel: {
    ...theme.type.bodyStrong,
    color: theme.color.onBrand,
    textAlign: 'center',
  },
  help: {
    ...theme.type.caption,
    color: theme.color.inkMuted,
    textAlign: 'center',
    marginTop: theme.space.xl,
  },
});
