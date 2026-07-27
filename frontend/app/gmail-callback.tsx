import { useEffect } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { theme } from '@/src/theme';

/**
 * Landing point for the Gmail OAuth redirect.
 *
 * expo-auth-session captures the redirect inside the auth sheet and exchanges
 * the code itself, so nothing here touches tokens. The screen exists because
 * Expo Router *also* receives the deep link and navigates to its path — without
 * a matching route the user gets dumped on "Unmatched Route" mid-flow.
 *
 * The path is kept in sync with redirectUri() in src/gmail/auth.ts.
 */
export default function GmailCallback() {
  const router = useRouter();

  useEffect(() => {
    // back() rather than replace() when possible, so the scan screen already on
    // the stack is reused — it re-reads the stored grant when it regains focus.
    if (router.canGoBack()) router.back();
    else router.replace('/scan');
  }, [router]);

  return (
    <View style={styles.container} testID="gmail-callback">
      <ActivityIndicator color={theme.color.brand} size="large" />
      <Text style={styles.text}>Connecting Gmail…</Text>
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
