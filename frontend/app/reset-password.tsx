/**
 * Where a password recovery link lands.
 *
 * The email carries a one-time code rather than a session. Exchanging it here —
 * on the device that asked for the reset, which is the only one holding the PKCE
 * verifier — signs the user in just long enough to choose a new password. A
 * forwarded email is therefore useless to whoever receives it.
 *
 * Three states, and the screen never shows two at once: working out whether the
 * link is any good, taking the new password, or explaining that the link has
 * expired with the way to get another one.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView,
  StyleSheet, Text, TextInput, View,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';

import { useAuth } from '@/src/auth-context';
import { supabase } from '@/src/supabase';
import { theme } from '@/src/theme';
import { Press } from '@/src/motion';

const MIN_PASSWORD = 6;

type Phase = 'checking' | 'ready' | 'expired';

export default function ResetPassword() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { updatePassword } = useAuth();
  const { code } = useLocalSearchParams<{ code?: string }>();

  const [phase, setPhase] = useState<Phase>('checking');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [reveal, setReveal] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const confirmRef = useRef<TextInput>(null);

  useEffect(() => {
    let alive = true;

    (async () => {
      if (!code) {
        if (alive) setPhase('expired');
        return;
      }
      const { error } = await supabase.auth.exchangeCodeForSession(code);
      if (!alive) return;
      setPhase(error ? 'expired' : 'ready');
    })();

    return () => {
      alive = false;
    };
  }, [code]);

  const submit = useCallback(async () => {
    setErr(null);

    if (password.length < MIN_PASSWORD) {
      setErr(`Use at least ${MIN_PASSWORD} characters.`);
      return;
    }
    if (password !== confirm) {
      setErr('Those two do not match.');
      return;
    }

    setBusy(true);
    try {
      await updatePassword(password);
      // Straight in — the recovery exchange already signed them in, so asking
      // them to type the password they just chose would be theatre.
      router.replace('/');
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not set that password.');
    } finally {
      setBusy(false);
    }
  }, [password, confirm, updatePassword, router]);

  return (
    <View style={s.root}>
      <LinearGradient
        colors={theme.color.coralGradient}
        start={{ x: 0.1, y: 0 }}
        end={{ x: 0.9, y: 1 }}
        style={StyleSheet.absoluteFill}
      />

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1 }}
      >
        <ScrollView
          contentContainerStyle={[
            s.scroll,
            { paddingTop: insets.top + 72, paddingBottom: insets.bottom + 28 },
          ]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {phase === 'checking' && (
            <View style={s.centred} testID="reset-checking">
              <ActivityIndicator color="#FFFFFF" size="large" />
              <Text style={s.checkingText}>Checking your link</Text>
            </View>
          )}

          {phase === 'expired' && (
            <Animated.View entering={FadeInDown.duration(500)} testID="reset-expired">
              <View style={s.badge}>
                <Ionicons name="time-outline" size={22} color="#FFFFFF" />
              </View>
              <Text style={s.title}>That link has expired</Text>
              <Text style={s.blurb}>
                Reset links last one hour and work once. Ask for a fresh one and open
                it on this phone — a link opened anywhere else cannot sign you in.
              </Text>
              <Press onPress={() => router.replace('/auth')} haptic="medium" testID="reset-back">
                <View style={s.primary}>
                  <Text style={s.primaryText}>Back to sign in</Text>
                </View>
              </Press>
            </Animated.View>
          )}

          {phase === 'ready' && (
            <Animated.View entering={FadeInDown.duration(500)}>
              <View style={s.badge}>
                <Ionicons name="lock-open-outline" size={22} color="#FFFFFF" />
              </View>
              <Text style={s.title}>Choose a new password</Text>
              <Text style={s.blurb}>
                At least {MIN_PASSWORD} characters. You will be signed in straight
                after — no need to type it again.
              </Text>

              {err !== null && (
                <Animated.View
                  entering={FadeIn.duration(240)}
                  style={s.message}
                  accessibilityLiveRegion="polite"
                >
                  <Ionicons name="alert-circle" size={16} color="#FFFFFF" />
                  <Text style={s.messageText} testID="reset-error">{err}</Text>
                </Animated.View>
              )}

              <View style={s.field}>
                <TextInput
                  value={password}
                  onChangeText={setPassword}
                  placeholder="New password"
                  placeholderTextColor="rgba(255,255,255,0.55)"
                  secureTextEntry={!reveal}
                  autoComplete="new-password"
                  autoCapitalize="none"
                  returnKeyType="next"
                  onSubmitEditing={() => confirmRef.current?.focus()}
                  submitBehavior="submit"
                  style={s.input}
                  testID="reset-password-input"
                />
                <Press
                  onPress={() => setReveal((v) => !v)}
                  haptic="selection"
                  style={s.reveal}
                  testID="reset-reveal"
                >
                  <Ionicons
                    name={reveal ? 'eye-off-outline' : 'eye-outline'}
                    size={20}
                    color="rgba(255,255,255,0.8)"
                  />
                </Press>
              </View>

              <TextInput
                ref={confirmRef}
                value={confirm}
                onChangeText={setConfirm}
                placeholder="Type it once more"
                placeholderTextColor="rgba(255,255,255,0.55)"
                secureTextEntry={!reveal}
                autoComplete="new-password"
                autoCapitalize="none"
                returnKeyType="go"
                onSubmitEditing={submit}
                style={[s.input, { marginTop: 11 }]}
                testID="reset-confirm-input"
              />

              <Press onPress={submit} disabled={busy} haptic="medium" testID="reset-submit">
                <View style={[s.primary, { marginTop: 18 }]}>
                  {busy ? (
                    <ActivityIndicator color={theme.color.brandDeep} />
                  ) : (
                    <Text style={s.primaryText}>Set password and sign in</Text>
                  )}
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
  scroll: { flexGrow: 1, paddingHorizontal: 28, justifyContent: 'center' },

  centred: { alignItems: 'center', gap: 18 },
  checkingText: { color: 'rgba(255,255,255,0.9)', fontSize: 14.5, fontWeight: '700' },

  badge: {
    width: 46, height: 46, borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center', justifyContent: 'center',
    marginBottom: 22,
  },
  title: {
    color: '#FFFFFF', fontSize: 32, fontWeight: '800',
    letterSpacing: -1.2, lineHeight: 38,
  },
  blurb: {
    color: 'rgba(255,255,255,0.82)', fontSize: 14.5, lineHeight: 21,
    fontWeight: '500', marginTop: 12, marginBottom: 24,
  },

  message: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 9,
    backgroundColor: 'rgba(0,0,0,0.24)', borderRadius: theme.radius.md,
    padding: 13, marginBottom: 14,
  },
  messageText: { flex: 1, color: '#FFFFFF', fontSize: 13, lineHeight: 19, fontWeight: '600' },

  field: { justifyContent: 'center' },
  input: {
    height: 54, borderRadius: theme.radius.md,
    backgroundColor: 'rgba(0,0,0,0.2)',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.24)',
    paddingHorizontal: 18, color: '#FFFFFF', fontSize: 16, fontWeight: '600',
  },
  reveal: {
    position: 'absolute', right: 6, height: 44, width: 44,
    alignItems: 'center', justifyContent: 'center',
  },

  primary: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9,
    height: 56, borderRadius: theme.radius.pill, backgroundColor: '#FFFFFF',
  },
  primaryText: { color: theme.color.brandDeep, fontSize: 15.5, fontWeight: '800' },
});
