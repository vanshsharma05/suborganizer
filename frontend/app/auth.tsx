/**
 * Sign-in.
 *
 * The gradient runs unbroken from here into the story, so signing in reads as
 * stepping through a door rather than as one screen replacing another. Nothing
 * competes with that: no photograph behind it, no card floating on top.
 *
 * Google leads and the email form stays hidden until asked for, because most
 * people will tap Google and never need it — and a form is the single most
 * effective way to make an app feel like work before it has done anything.
 *
 * The three lines under the headline are the pitch. They are specific numbers
 * rather than adjectives, since "organise your subscriptions" describes a
 * spreadsheet and "find the ₹4,000 a year you forgot about" describes a reason.
 */

import React, { useEffect, useState } from 'react';
import {
  View, Text, TextInput, StyleSheet, KeyboardAvoidingView, Platform,
  ScrollView, ActivityIndicator,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import Animated, {
  Easing, FadeIn, FadeInDown, FadeInUp, SlideInDown, SlideOutDown,
  useAnimatedStyle, useSharedValue, withRepeat, withTiming,
} from 'react-native-reanimated';
import { useAuth } from '@/src/auth-context';
import { theme } from '@/src/theme';
import { Press } from '@/src/motion';

const SELLING_POINTS: { icon: keyof typeof Ionicons.glyphMap; text: string }[] = [
  { icon: 'mail-open', text: 'Finds subscriptions hiding in your Gmail' },
  { icon: 'trending-down', text: 'Spots cheaper plans and price rises' },
  { icon: 'alarm', text: 'Warns you before a free trial charges' },
];

/** Slow drift behind the gradient, so the first screen is never quite static. */
function Aurora() {
  const t = useSharedValue(0);

  useEffect(() => {
    t.value = withRepeat(
      withTiming(1, { duration: 11000, easing: Easing.inOut(Easing.sin) }),
      -1,
      true,
    );
  }, [t]);

  const a = useAnimatedStyle(() => ({
    transform: [
      { translateX: -60 + t.value * 90 },
      { translateY: -30 + t.value * 60 },
      { scale: 1 + t.value * 0.12 },
    ],
  }));

  const b = useAnimatedStyle(() => ({
    transform: [
      { translateX: 40 - t.value * 70 },
      { translateY: 20 - t.value * 50 },
      { scale: 1.15 - t.value * 0.1 },
    ],
  }));

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <Animated.View style={[s.blob, { top: -120, left: -90, width: 320, height: 320 }, a]} />
      <Animated.View style={[s.blob, { bottom: -80, right: -110, width: 380, height: 380 }, b]} />
    </View>
  );
}

export default function AuthScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { signInWithEmail, signUpWithEmail, signInWithGoogle, user } = useAuth();

  const [showEmail, setShowEmail] = useState(false);
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [googleBusy, setGoogleBusy] = useState(false);

  useEffect(() => {
    if (user) router.replace('/');
  }, [user, router]);

  const submit = async () => {
    setErr(null);
    setNotice(null);

    if (!email || !password || (mode === 'signup' && !name)) {
      setErr('Please fill in all fields');
      return;
    }
    if (mode === 'signup' && password.length < 6) {
      setErr('Password must be at least 6 characters');
      return;
    }

    setBusy(true);
    try {
      if (mode === 'login') {
        await signInWithEmail(email, password);
      } else {
        const { needsConfirmation } = await signUpWithEmail(name, email, password);
        if (needsConfirmation) {
          setNotice(`Almost there — we sent a confirmation link to ${email.trim()}. Tap it, then sign in.`);
          setMode('login');
          setPassword('');
        }
      }
      // On success the auth listener flips `user`, and the effect above routes.
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  };

  const googleSignIn = async () => {
    setErr(null);
    setNotice(null);
    setGoogleBusy(true);
    try {
      await signInWithGoogle();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Google sign-in failed');
    } finally {
      setGoogleBusy(false);
    }
  };

  return (
    <View style={s.root}>
      <LinearGradient
        colors={theme.color.coralGradient}
        start={{ x: 0.1, y: 0 }}
        end={{ x: 0.9, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
      <Aurora />

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1 }}
      >
        <ScrollView
          contentContainerStyle={[
            s.scroll,
            { paddingTop: insets.top + 64, paddingBottom: insets.bottom + 24 },
          ]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <Animated.View entering={FadeInDown.duration(700)} style={s.brand}>
            {/* Radius ratio (2/14) matches the launcher icon, so the in-app mark
                and the icon on the home screen read as the same shape. */}
            <View style={s.mark} />
            <Text style={s.brandName}>SubOrganizer</Text>
          </Animated.View>

          <Animated.Text entering={FadeInDown.delay(140).duration(700)} style={s.hero}>
            Every{'\n'}subscription.{'\n'}One view.
          </Animated.Text>

          {!showEmail && (
            <View style={s.points}>
              {SELLING_POINTS.map((p, i) => (
                <Animated.View
                  key={p.text}
                  entering={FadeInUp.delay(320 + i * 110).duration(600)}
                  style={s.point}
                >
                  <View style={s.pointIcon}>
                    <Ionicons name={p.icon} size={14} color="#FFFFFF" />
                  </View>
                  <Text style={s.pointText}>{p.text}</Text>
                </Animated.View>
              ))}
            </View>
          )}

          <View style={{ flex: 1, minHeight: 24 }} />

          {(err ?? notice) !== null && (
            <Animated.View entering={FadeIn.duration(280)} style={s.message}>
              <Ionicons name={err !== null ? 'alert-circle' : 'mail-unread'} size={16} color="#FFFFFF" />
              <Text style={s.messageText} testID={err !== null ? 'auth-error' : 'auth-notice'}>
                {err ?? notice}
              </Text>
            </Animated.View>
          )}

          {!showEmail ? (
            <Animated.View entering={FadeInUp.delay(680).duration(600)}>
              <Press onPress={googleSignIn} disabled={googleBusy} haptic="medium" testID="auth-google">
                <View style={s.primary}>
                  {googleBusy ? (
                    <ActivityIndicator color={theme.color.brandDeep} />
                  ) : (
                    <>
                      <Ionicons name="logo-google" size={18} color="#DB4437" />
                      <Text style={s.primaryText}>Continue with Google</Text>
                    </>
                  )}
                </View>
              </Press>

              <Press
                onPress={() => {
                  setShowEmail(true);
                  setErr(null);
                }}
                testID="auth-use-email"
              >
                <View style={s.ghost}>
                  <Text style={s.ghostText}>Use email instead</Text>
                </View>
              </Press>

              <Text style={s.legal}>
                Free to use. The Gmail scan and the savings audit are one-time unlocks — never a
                subscription.
              </Text>
            </Animated.View>
          ) : (
            <Animated.View
              entering={SlideInDown.duration(380)}
              exiting={SlideOutDown.duration(240)}
              style={{ gap: 11 }}
            >
              <View style={s.segment}>
                {(['login', 'signup'] as const).map((m) => (
                  <Press
                    key={m}
                    onPress={() => {
                      setMode(m);
                      setErr(null);
                    }}
                    style={{ flex: 1 }}
                    testID={`auth-tab-${m}`}
                  >
                    <View style={[s.segItem, mode === m && s.segActive]}>
                      <Text style={[s.segText, mode === m && s.segTextActive]}>
                        {m === 'login' ? 'Sign in' : 'Create account'}
                      </Text>
                    </View>
                  </Press>
                ))}
              </View>

              {mode === 'signup' && (
                <TextInput
                  value={name}
                  onChangeText={setName}
                  placeholder="Your name"
                  placeholderTextColor="rgba(255,255,255,0.55)"
                  style={s.input}
                  autoCapitalize="words"
                  testID="auth-name-input"
                />
              )}
              <TextInput
                value={email}
                onChangeText={setEmail}
                placeholder="you@example.com"
                placeholderTextColor="rgba(255,255,255,0.55)"
                keyboardType="email-address"
                autoCapitalize="none"
                autoComplete="email"
                style={s.input}
                testID="auth-email-input"
              />
              <TextInput
                value={password}
                onChangeText={setPassword}
                placeholder={mode === 'signup' ? 'At least 6 characters' : 'Password'}
                placeholderTextColor="rgba(255,255,255,0.55)"
                secureTextEntry
                style={s.input}
                testID="auth-password-input"
              />

              <Press onPress={submit} disabled={busy} haptic="medium" testID="auth-submit">
                <View style={[s.primary, { marginTop: 5 }]}>
                  {busy ? (
                    <ActivityIndicator color={theme.color.brandDeep} />
                  ) : (
                    <Text style={s.primaryText}>
                      {mode === 'login' ? 'Sign in' : 'Create account'}
                    </Text>
                  )}
                </View>
              </Press>

              <Press
                onPress={() => {
                  setShowEmail(false);
                  setErr(null);
                }}
                testID="auth-back-to-google"
              >
                <View style={s.ghost}>
                  <Text style={s.ghostText}>Back</Text>
                </View>
              </Press>
            </Animated.View>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.color.brandPrimary },
  scroll: { flexGrow: 1, paddingHorizontal: 28 },
  blob: { position: 'absolute', borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.1)' },

  brand: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  mark: {
    width: 14, height: 14, borderRadius: 2,
    backgroundColor: '#FFFFFF', transform: [{ rotate: '45deg' }],
  },
  brandName: { color: '#FFFFFF', fontSize: 15, fontWeight: '700', letterSpacing: 0.6 },

  hero: {
    color: '#FFFFFF', fontSize: 46, fontWeight: '800',
    letterSpacing: -2, lineHeight: 52, marginTop: 40,
  },

  points: { gap: 13, marginTop: 26 },
  point: { flexDirection: 'row', alignItems: 'center', gap: 11 },
  pointIcon: {
    width: 28, height: 28, borderRadius: 10,
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center', justifyContent: 'center',
  },
  pointText: {
    flex: 1, color: 'rgba(255,255,255,0.94)',
    fontSize: 14.5, fontWeight: '600', letterSpacing: -0.2,
  },

  message: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 9,
    backgroundColor: 'rgba(0,0,0,0.24)', borderRadius: theme.radius.md,
    padding: 13, marginBottom: 14,
  },
  messageText: { flex: 1, color: '#FFFFFF', fontSize: 13, lineHeight: 19, fontWeight: '600' },

  primary: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9,
    height: 56, borderRadius: theme.radius.pill, backgroundColor: '#FFFFFF',
  },
  primaryText: { color: theme.color.brandDeep, fontSize: 15.5, fontWeight: '800' },

  ghost: { alignItems: 'center', paddingVertical: 16 },
  ghostText: { color: 'rgba(255,255,255,0.88)', fontSize: 14, fontWeight: '700' },

  legal: {
    color: 'rgba(255,255,255,0.68)', fontSize: 11.5, lineHeight: 17,
    textAlign: 'center', paddingHorizontal: 6,
  },

  segment: {
    flexDirection: 'row', backgroundColor: 'rgba(0,0,0,0.2)',
    borderRadius: theme.radius.pill, padding: 4, marginBottom: 4,
  },
  segItem: {
    height: 40, borderRadius: theme.radius.pill,
    alignItems: 'center', justifyContent: 'center',
  },
  segActive: { backgroundColor: 'rgba(255,255,255,0.96)' },
  segText: { color: 'rgba(255,255,255,0.82)', fontWeight: '700', fontSize: 13 },
  segTextActive: { color: theme.color.brandDeep },

  input: {
    height: 54, borderRadius: theme.radius.md,
    backgroundColor: 'rgba(0,0,0,0.2)',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.24)',
    paddingHorizontal: 18, color: '#FFFFFF', fontSize: 16, fontWeight: '600',
  },
});
