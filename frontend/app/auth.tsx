import React, { useEffect, useState } from 'react';
import {
  View, Text, TextInput, StyleSheet, KeyboardAvoidingView, Platform, Pressable,
  ScrollView, ActivityIndicator,
} from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useAuth } from '@/src/auth-context';
import { theme, IMAGES } from '@/src/theme';
import { GradientButton } from '@/src/ui';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';

export default function AuthScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { login, signup, user } = useAuth();
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (user) router.replace('/(tabs)/dashboard');
  }, [user, router]);

  const submit = async () => {
    setErr(null);
    if (!email || !password || (mode === 'signup' && !name)) {
      setErr('Please fill in all fields');
      return;
    }
    setBusy(true);
    try {
      if (mode === 'login') await login(email.trim(), password);
      else await signup(name.trim(), email.trim(), password);
    } catch (e: any) {
      setErr(e.message || 'Something went wrong');
    } finally {
      setBusy(false);
    }
  };

  const fillDemo = () => {
    setMode('login');
    setEmail('demo@suborganizer.app');
    setPassword('demo1234');
  };

  return (
    <View style={styles.root}>
      <Image source={{ uri: IMAGES.heroMesh }} style={StyleSheet.absoluteFillObject} contentFit="cover" />
      <LinearGradient
        colors={['rgba(253,251,247,0)', 'rgba(253,251,247,0.4)', theme.color.surface]}
        style={StyleSheet.absoluteFillObject}
        locations={[0, 0.55, 1]}
      />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
        <ScrollView
          contentContainerStyle={[styles.scroll, { paddingTop: insets.top + 40, paddingBottom: insets.bottom + 40 }]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <Animated.View entering={FadeInDown.duration(600)} style={styles.brand}>
            <View style={styles.logoDot} />
            <Text style={styles.brandName}>SubOrganizer</Text>
          </Animated.View>

          <Animated.View entering={FadeInDown.duration(700).delay(120)} style={{ marginTop: 40 }}>
            <Text style={styles.eyebrow}>Every subscription. One view.</Text>
            <Text style={styles.hero}>
              Take back{'\n'}
              <Text style={{ color: theme.color.brandPrimary }}>control</Text>{' '}
              of what you pay for.
            </Text>
          </Animated.View>

          <Animated.View entering={FadeIn.duration(600).delay(300)} style={styles.card}>
            <View style={styles.segment}>
              <Pressable
                onPress={() => setMode('login')}
                style={[styles.segItem, mode === 'login' && styles.segActive]}
                testID="auth-tab-login"
              >
                <Text style={[styles.segText, mode === 'login' && styles.segTextActive]}>Sign in</Text>
              </Pressable>
              <Pressable
                onPress={() => setMode('signup')}
                style={[styles.segItem, mode === 'signup' && styles.segActive]}
                testID="auth-tab-signup"
              >
                <Text style={[styles.segText, mode === 'signup' && styles.segTextActive]}>Create account</Text>
              </Pressable>
            </View>

            {mode === 'signup' && (
              <View style={styles.field}>
                <Text style={styles.fieldLabel}>Name</Text>
                <TextInput
                  value={name} onChangeText={setName}
                  placeholder="Ava Chen"
                  placeholderTextColor={theme.color.inkMuted}
                  style={styles.input}
                  testID="auth-name-input"
                  autoCapitalize="words"
                />
              </View>
            )}
            <View style={styles.field}>
              <Text style={styles.fieldLabel}>Email</Text>
              <TextInput
                value={email} onChangeText={setEmail}
                placeholder="you@example.com"
                placeholderTextColor={theme.color.inkMuted}
                keyboardType="email-address"
                autoCapitalize="none"
                autoComplete="email"
                style={styles.input}
                testID="auth-email-input"
              />
            </View>
            <View style={styles.field}>
              <Text style={styles.fieldLabel}>Password</Text>
              <TextInput
                value={password} onChangeText={setPassword}
                placeholder="********"
                placeholderTextColor={theme.color.inkMuted}
                secureTextEntry
                style={styles.input}
                testID="auth-password-input"
              />
            </View>

            {err && <Text style={styles.err} testID="auth-error">{err}</Text>}

            <View style={{ height: 8 }} />
            {busy ? (
              <View style={styles.busyBtn}><ActivityIndicator color="#fff" /></View>
            ) : (
              <GradientButton
                onPress={submit}
                label={mode === 'login' ? 'Sign in' : 'Create account'}
                testID="auth-submit"
              />
            )}

            <Pressable onPress={fillDemo} style={styles.demoBtn} testID="auth-demo">
              <Text style={styles.demoText}>Try with a demo account →</Text>
            </Pressable>
          </Animated.View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.color.surface },
  scroll: { paddingHorizontal: 24 },
  brand: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  logoDot: { width: 14, height: 14, borderRadius: 4, backgroundColor: theme.color.brandPrimary, transform: [{ rotate: '45deg' }] },
  brandName: { color: theme.color.ink, fontSize: 16, fontWeight: '700', letterSpacing: 0.4 },
  eyebrow: {
    color: theme.color.brandPrimary, fontSize: 12, fontWeight: '700',
    letterSpacing: 1.4, textTransform: 'uppercase',
  },
  hero: {
    color: theme.color.ink, fontSize: 40, fontWeight: '800', letterSpacing: -1.2, lineHeight: 46, marginTop: 8,
  },
  card: {
    marginTop: 32, backgroundColor: 'rgba(255,255,255,0.85)', borderRadius: 28, padding: 20,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.9)',
    shadowColor: '#1A1C1E', shadowOpacity: 0.06, shadowRadius: 24, shadowOffset: { width: 0, height: 12 },
  },
  segment: {
    flexDirection: 'row', backgroundColor: theme.color.surfaceSecondary,
    borderRadius: theme.radius.pill, padding: 4, marginBottom: 20,
  },
  segItem: { flex: 1, height: 40, borderRadius: theme.radius.pill, alignItems: 'center', justifyContent: 'center' },
  segActive: { backgroundColor: '#FFFFFF', shadowColor: '#1A1C1E', shadowOpacity: 0.06, shadowRadius: 6, shadowOffset: { width: 0, height: 2 } },
  segText: { color: theme.color.inkSoft, fontWeight: '600', fontSize: 13 },
  segTextActive: { color: theme.color.ink },
  field: { marginBottom: 14 },
  fieldLabel: {
    color: theme.color.inkSoft, fontSize: 11, fontWeight: '700',
    letterSpacing: 0.8, textTransform: 'uppercase', marginBottom: 6,
  },
  input: {
    height: 52, borderRadius: 14, backgroundColor: theme.color.surface,
    borderWidth: 1, borderColor: theme.color.border, paddingHorizontal: 16,
    color: theme.color.ink, fontSize: 16,
  },
  err: { color: theme.color.error, marginTop: 4, fontSize: 13, fontWeight: '600' },
  busyBtn: { height: 56, borderRadius: theme.radius.pill, backgroundColor: theme.color.brandDeep, alignItems: 'center', justifyContent: 'center' },
  demoBtn: { alignItems: 'center', marginTop: 14 },
  demoText: { color: theme.color.brandSecondary, fontWeight: '600', fontSize: 13 },
});
