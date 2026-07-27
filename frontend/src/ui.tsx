import React, { useState } from 'react';
import { View, Text, StyleSheet, Pressable, ViewStyle, TextStyle } from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { theme } from './theme';
import { Subscription } from './api';
import { fmtMoney, symbolFor } from './currency';

// Only the three fields the avatar actually draws from, so callers holding
// something subscription-shaped — a Gmail scan candidate, say — can use it.
type Brandable = Pick<Subscription, 'name'> & Partial<Pick<Subscription, 'domain' | 'brand_color'>>;

export function BrandAvatar({ sub, size = 44 }: { sub: Brandable; size?: number }) {
  const initial = sub.name.charAt(0).toUpperCase();
  const bg = sub.brand_color || theme.color.brand;
  const [srcIdx, setSrcIdx] = useState(0);
  const sources = sub.domain ? [
    `https://logo.clearbit.com/${sub.domain}`,
    `https://www.google.com/s2/favicons?domain=${sub.domain}&sz=128`,
    `https://icons.duckduckgo.com/ip3/${sub.domain}.ico`,
  ] : [];

  const showFallback = !sub.domain || srcIdx >= sources.length;

  return (
    <View
      style={[
        stylesAv.wrap,
        { width: size, height: size, borderRadius: size * 0.28, backgroundColor: showFallback ? bg : '#FFFFFF', borderColor: bg + '35' },
      ]}
    >
      {showFallback ? (
        <Text style={{ color: '#FFFFFF', fontSize: size * 0.42, fontWeight: '800' }}>{initial}</Text>
      ) : (
        <Image
          source={{ uri: sources[srcIdx] }}
          style={{ width: size * 0.78, height: size * 0.78, borderRadius: size * 0.18 }}
          contentFit="contain"
          transition={200}
          onError={() => setSrcIdx((i) => i + 1)}
          cachePolicy="memory-disk"
        />
      )}
    </View>
  );
}

const stylesAv = StyleSheet.create({
  wrap: { alignItems: 'center', justifyContent: 'center', borderWidth: 1, overflow: 'hidden' },
});

export function GradientButton({
  onPress, label, testID, variant = 'primary', disabled,
}: {
  onPress: () => void; label: string; testID?: string; variant?: 'primary' | 'dark' | 'ghost'; disabled?: boolean;
}) {
  const colors =
    variant === 'primary' ? theme.color.coralGradient :
    variant === 'dark' ? (['#1A1C1E', '#2F3A3A'] as const) :
    (['#FFFFFF', '#FFFFFF'] as const);
  return (
    <Pressable onPress={onPress} disabled={disabled} testID={testID} style={({ pressed }) => [{ opacity: disabled ? 0.5 : pressed ? 0.85 : 1 }]}>
      <LinearGradient colors={colors} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={btnStyles.btn}>
        <Text style={[btnStyles.label, variant === 'ghost' && { color: theme.color.ink }]}>{label}</Text>
      </LinearGradient>
    </Pressable>
  );
}
const btnStyles = StyleSheet.create({
  btn: {
    height: 56, borderRadius: theme.radius.pill, alignItems: 'center', justifyContent: 'center',
    shadowColor: '#D36043', shadowOpacity: 0.25, shadowRadius: 16, shadowOffset: { width: 0, height: 8 }, elevation: 4,
  },
  label: { color: '#FFFFFF', fontSize: 16, fontWeight: '700', letterSpacing: 0.2 },
});

export function Chip({
  label, active, onPress, testID,
}: { label: string; active?: boolean; onPress?: () => void; testID?: string }) {
  return (
    <Pressable onPress={onPress} testID={testID} style={[chipStyles.chip, active && chipStyles.chipActive]}>
      <Text style={[chipStyles.label, active && chipStyles.labelActive]}>{label}</Text>
    </Pressable>
  );
}
const chipStyles = StyleSheet.create({
  chip: {
    height: 36, paddingHorizontal: 16, borderRadius: theme.radius.pill,
    borderWidth: 1, borderColor: theme.color.border, backgroundColor: '#FFFFFF',
    alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  chipActive: { borderColor: theme.color.ink, backgroundColor: theme.color.ink },
  label: { color: theme.color.inkSoft, fontSize: 13, fontWeight: '600' },
  labelActive: { color: '#FFFFFF' },
});

export function StatPill({ label, value, containerStyle, valueStyle }: {
  label: string; value: string; containerStyle?: ViewStyle; valueStyle?: TextStyle;
}) {
  return (
    <View style={[pillStyles.wrap, containerStyle]}>
      <Text style={pillStyles.value} numberOfLines={1}>{value}</Text>
      <Text style={pillStyles.label} numberOfLines={1}>{label}</Text>
    </View>
  );
}
const pillStyles = StyleSheet.create({
  wrap: {
    backgroundColor: '#FFFFFF', borderRadius: theme.radius.lg,
    paddingVertical: 14, paddingHorizontal: 16, borderWidth: 1, borderColor: theme.color.border, flex: 1,
  },
  value: { color: theme.color.ink, fontSize: 22, fontWeight: '800', letterSpacing: -0.5 },
  label: { color: theme.color.inkSoft, fontSize: 11, fontWeight: '600', letterSpacing: 0.6, textTransform: 'uppercase', marginTop: 2 },
});

export function formatMoney(n: number, currency?: string): string {
  return fmtMoney(n, currency);
}
export function formatMoneyRounded(n: number, currency?: string): string {
  return fmtMoney(n, currency, { compact: true });
}
