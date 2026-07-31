import { useEffect, useState } from 'react';
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { useAuth } from '@/src/auth-context';
import { shouldPlayNow } from '@/src/story-storage';
import { theme } from '@/src/theme';

export default function Index() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [routed, setRouted] = useState(false);

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
});
