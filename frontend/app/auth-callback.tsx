import { useEffect } from 'react';
import { View, ActivityIndicator, StyleSheet, Text } from 'react-native';
import { useRouter } from 'expo-router';
import { theme } from '@/src/theme';
import { useAuth } from '@/src/auth-context';

/**
 * Landing point for the Google OAuth redirect.
 *
 * Only the web build actually renders this. On native, expo-auth-session
 * intercepts the `suborganizer://auth-callback` redirect inside the auth sheet
 * and exchanges the code itself, so this route never mounts there.
 *
 * On web, supabase-js sees the `?code=` on the URL and completes the exchange
 * via detectSessionInUrl — all this screen does is hold the user for the moment
 * that takes, then hand off once the session lands.
 */
export default function AuthCallback() {
  const router = useRouter();
  const { user, loading } = useAuth();

  useEffect(() => {
    if (loading) return;
    router.replace(user ? '/(tabs)/dashboard' : '/auth');
  }, [user, loading, router]);

  return (
    <View style={styles.container} testID="auth-callback">
      <ActivityIndicator color={theme.color.brand} size="large" />
      <Text style={styles.text}>Signing you in…</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.color.surface,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
  },
  text: { color: theme.color.inkSoft, fontSize: 14, fontWeight: '600' },
});
