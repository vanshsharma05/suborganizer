import { useEffect, useState } from 'react';
import { View, ActivityIndicator, StyleSheet, Text } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import { useRouter } from 'expo-router';
import { useAuth } from '@/src/auth-context';
import { shouldPlayNow } from '@/src/story-storage';
import { theme } from '@/src/theme';

/**
 * How long the spinner stands alone before it starts explaining itself.
 *
 * Long enough that the normal path — which resolves in well under a second and
 * spends most of that behind the launch animation — never shows a word. An
 * unexplained spinner is only frightening once it has outstayed its welcome,
 * and captioning it instantly would put words on screen that flash past
 * unread on every single launch.
 */
const EXPLAIN_AFTER_MS = 2_500;

/** Past this, the delay is no longer normal and the likely cause is worth naming. */
const BLAME_NETWORK_AFTER_MS = 7_000;

export default function Index() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [routed, setRouted] = useState(false);
  const [waited, setWaited] = useState<0 | 1 | 2>(0);

  useEffect(() => {
    const explain = setTimeout(() => setWaited(1), EXPLAIN_AFTER_MS);
    const blame = setTimeout(() => setWaited(2), BLAME_NETWORK_AFTER_MS);
    return () => {
      clearTimeout(explain);
      clearTimeout(blame);
    };
  }, []);

  useEffect(() => {
    if (loading || routed) return;

    if (!user) {
      setRouted(true);
      router.replace('/auth');
      return;
    }

    let alive = true;

    (async () => {
      // Reads AsyncStorage only — no network, so this cannot reintroduce the
      // stall that used to leave the app on this spinner. Any failure inside
      // shouldPlayNow resolves to false rather than throwing.
      //
      // `hasContent` is true unconditionally here, deliberately. Subscriptions
      // load in the background, so at this instant the list is always empty and
      // gating on it would mean the story never played on a fresh sign-in. The
      // story screen derives its own slides from context and rebuilds when they
      // arrive — and its empty case is the Gmail scan offer, which is the right
      // first-run screen anyway.
      const play = await shouldPlayNow(true);
      if (!alive) return;
      setRouted(true);
      router.replace(play ? '/story' : '/(tabs)/dashboard');
    })();

    return () => {
      alive = false;
    };
  }, [user, loading, routed, router]);

  return (
    <View style={styles.container} testID="app-loading">
      <ActivityIndicator color={theme.color.brand} size="large" />

      {waited > 0 && (
        <Animated.Text entering={FadeIn.duration(400)} style={styles.status}>
          {waited === 1 ? 'Getting things ready' : 'Still trying to reach the server'}
        </Animated.Text>
      )}

      {waited === 2 && (
        <Animated.View entering={FadeIn.duration(400).delay(200)}>
          <Text style={styles.hint}>Check your connection</Text>
        </Animated.View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.color.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  status: {
    ...theme.type.body,
    color: theme.color.inkSoft,
    marginTop: theme.space.xl,
    textAlign: 'center',
  },
  hint: {
    ...theme.type.caption,
    color: theme.color.inkMuted,
    marginTop: theme.space.sm,
    textAlign: 'center',
  },
});
