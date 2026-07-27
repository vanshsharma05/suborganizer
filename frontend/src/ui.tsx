import React from 'react';
import { View, Text, StyleSheet, Pressable, ViewStyle, TextStyle } from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { theme } from './theme';
import { Subscription } from './api';

export function BrandAvatar({ sub, size = 44 }: { sub: Subscription; size?: number }) {
  const initial = sub.name.charAt(0).toUpperCase();
  const bg = sub.brand_color || theme.color.brand;
  return (
    <View
      style={[
        stylesAv.wrap,
        { width: size, height: size, borderRadius: size * 0.28, backgroundColor: bg + '18', borderColor: bg + '35' },
      ]}
    >
      {sub.domain ? (
        <Image
          source={{ uri: `https://logo.clearbit.com/${sub.domain}` }}
          style={{ width: size * 0.72, height: size * 0.72, borderRadius: size * 0.18 }}
          contentFit="contain"
          transition={200}
          onError={() => {}}
          placeholder={undefined}
        />
      ) : (
        <Text style={{ color: bg, fontSize: size * 0.42, fontWeight: '800' }}>{initial}</Text>
      )}
    </View>
  );
}

const stylesAv = StyleSheet.create({
  wrap: { alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
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

export function formatMoney(n: number): string {
  return `$${n.toFixed(2)}`;
}
export function formatMoneyRounded(n: number): string {
  return `$${Math.round(n).toLocaleString()}`;
}
