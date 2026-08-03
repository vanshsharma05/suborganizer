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

import React, { useEffect, useRef, useState } from 'react';
import {
  View, Text, TextInput, StyleSheet, KeyboardAvoidingView, Platform,
  ScrollView, ActivityIndicator, useWindowDimensions,
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
import { Segmented } from '@/src/ui';
import { looksLikeEmail } from '@/src/validate';

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
  const { width } = useWindowDimensions();
  const { signInWithEmail, signUpWithEmail, signInWithGoogle, resetPassword, user } = useAuth();

  const [showEmail, setShowEmail] = useState(false);
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [reveal, setReveal] = useState(false);
  const [focus, setFocus] = useState<'name' | 'email' | 'password' | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [googleBusy, setGoogleBusy] = useState(false);

  const emailRef = useRef<TextInput>(null);
  const passwordRef = useRef<TextInput>(null);
  const scrollRef = useRef<ScrollView>(null);

  /**
   * A backstop, not the mechanism.
   *
   * The form is laid out near the top once it opens, so on most phones nothing
   * needs scrolling at all. This covers the small screen where even the compact
   * layout overflows: it runs after the window has finished resizing, and does
   * nothing when the content already fits.
   */
  const revealForm = () => {
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 160);
  };

  /**
   * "subscription." is the longest word on the screen and it sits on its own
   * line by design. At a fixed 46px it runs past the edge on a 320dp phone,
   * which turns a three-line headline into four and breaks the shape.
   */
  const heroSize = Math.min(46, Math.round((width - 30) / 7.02));

  useEffect(() => {
    if (user) router.replace('/');
  }, [user, router]);

  const submit = async () => {
    setErr(null);
    setNotice(null);

    const address = email.trim();

    if (!address || !password || (mode === 'signup' && !name.trim())) {
      setErr('Please fill in all fields');
      return;
    }
    if (!looksLikeEmail(address)) {
      setErr('That does not look like an email address');
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

  /**
   * Reports success without confirming the address has an account, which is the
   * same thing Supabase does and for the same reason.
   */
  const forgotPassword = async () => {
    setErr(null);
    setNotice(null);

    const address = email.trim();
    if (!looksLikeEmail(address)) {
      setErr('Type your email address first, then tap this again');
      emailRef.current?.focus();
      return;
    }

    setBusy(true);
    try {
      await resetPassword(address);
      setNotice(`If ${address} has an account, a reset link is on its way. It lasts an hour, and has to be opened on this phone.`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not send the reset email');
    } finally {
      setBusy(false);
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
          ref={scrollRef}
          contentContainerStyle={[
            s.scroll,
            { paddingTop: insets.top + (showEmail ? 28 : 64), paddingBottom: insets.bottom + 24 },
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

          {showEmail ? (
            // Three lines of pitch is 130pt the person typing does not need.
            // One line keeps the screen from looking decapitated.
            <Text style={s.heroCompact}>Every subscription. One view.</Text>
          ) : (
            <Animated.Text
              entering={FadeInDown.delay(140).duration(700)}
              style={[s.hero, { fontSize: heroSize, lineHeight: Math.round(heroSize * 1.13) }]}
            >
              Every{'\n'}subscription.{'\n'}One view.
            </Animated.Text>
          )}

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

          {/* The spacer pins the Google button to the bottom, which is right
              while this is still a pitch. Once the form is open the keyboard
              owns half the screen, and pinning to the bottom is exactly what
              puts the inputs underneath it — so the form starts directly below
              the headline instead. */}
          {showEmail ? <View style={{ height: 20 }} /> : <View style={{ flex: 1, minHeight: 24 }} />}

          {(err ?? notice) !== null && (
            <Animated.View
              entering={FadeIn.duration(280)}
              style={s.message}
              // Without this the message is drawn but never announced, so a
              // screen-reader user taps Sign in and is told nothing at all.
              accessibilityLiveRegion="polite"
            >
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
                // Tapping this mid-Google would swap the screen out from under
                // a sheet that is still open and about to come back with a session.
                disabled={googleBusy}
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
              <Segmented<'login' | 'signup'>
                options={[
                  { value: 'login', label: 'Sign in' },
                  { value: 'signup', label: 'Create account' },
                ]}
                value={mode}
                onChange={(m) => {
                  setMode(m);
                  setErr(null);
                }}
                tone="onBrand"
                testID="auth-tab"
              />

              {mode === 'signup' && (
                <TextInput
                  value={name}
                  onChangeText={setName}
                  placeholder="Your name"
                  placeholderTextColor="rgba(255,255,255,0.55)"
                  style={[s.input, focus === 'name' && s.inputFocused]}
                  autoCapitalize="words"
                  autoComplete="name"
                  returnKeyType="next"
                  onSubmitEditing={() => emailRef.current?.focus()}
                  submitBehavior="submit"
                  onFocus={() => {
                    setFocus('name');
                    revealForm();
                  }}
                  onBlur={() => setFocus(null)}
                  testID="auth-name-input"
                />
              )}
              <TextInput
                ref={emailRef}
                value={email}
                onChangeText={setEmail}
                placeholder="you@example.com"
                placeholderTextColor="rgba(255,255,255,0.55)"
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
                autoComplete="email"
                returnKeyType="next"
                onSubmitEditing={() => passwordRef.current?.focus()}
                submitBehavior="submit"
                onFocus={() => {
                  setFocus('email');
                  revealForm();
                }}
                onBlur={() => setFocus(null)}
                style={[s.input, focus === 'email' && s.inputFocused]}
                testID="auth-email-input"
              />

              <View style={s.field}>
                <TextInput
                  ref={passwordRef}
                  value={password}
                  onChangeText={setPassword}
                  placeholder={mode === 'signup' ? 'At least 6 characters' : 'Password'}
                  placeholderTextColor="rgba(255,255,255,0.55)"
                  secureTextEntry={!reveal}
                  autoCapitalize="none"
                  // Tells a password manager whether to offer the saved one or
                  // to offer to save a new one. Without it, it offers neither.
                  autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                  returnKeyType="go"
                  onSubmitEditing={submit}
                  onFocus={() => {
                    setFocus('password');
                    revealForm();
                  }}
                  onBlur={() => setFocus(null)}
                  style={[s.input, s.inputWithButton, focus === 'password' && s.inputFocused]}
                  testID="auth-password-input"
                />
                {/* Typing a password you cannot see, on a phone keyboard, to an
                    account you are creating this second. */}
                <Press
                  onPress={() => setReveal((v) => !v)}
                  haptic="selection"
                  style={s.reveal}
                  testID="auth-reveal"
                >
                  <View style={s.revealHit}>
                    <Ionicons
                      name={reveal ? 'eye-off-outline' : 'eye-outline'}
                      size={20}
                      color="rgba(255,255,255,0.8)"
                    />
                  </View>
                </Press>
              </View>

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

              {mode === 'login' && (
                <Press onPress={forgotPassword} disabled={busy} testID="auth-forgot">
                  <View style={s.linkRow}>
                    <Text style={s.linkText}>Forgotten your password?</Text>
                  </View>
                </Press>
              )}

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

  // fontSize and lineHeight are set per device; see heroSize above.
  hero: {
    color: '#FFFFFF', fontWeight: '800',
    letterSpacing: -2, marginTop: 40,
  },
  heroCompact: {
    color: 'rgba(255,255,255,0.92)', fontSize: 17, fontWeight: '800',
    letterSpacing: -0.5, marginTop: 22,
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

  input: {
    height: 54, borderRadius: theme.radius.md,
    backgroundColor: 'rgba(0,0,0,0.2)',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.24)',
    paddingHorizontal: 18, color: '#FFFFFF', fontSize: 16, fontWeight: '600',
  },
  /** Which box the keyboard is typing into, which nothing said before. */
  inputFocused: {
    borderColor: 'rgba(255,255,255,0.9)',
    backgroundColor: 'rgba(0,0,0,0.28)',
  },
  inputWithButton: { paddingRight: 52 },

  field: { justifyContent: 'center' },
  reveal: { position: 'absolute', right: 5 },
  revealHit: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },

  linkRow: { alignItems: 'center', paddingVertical: 13 },
  linkText: {
    color: 'rgba(255,255,255,0.86)', fontSize: 13.5, fontWeight: '700',
    textDecorationLine: 'underline',
  },
});
