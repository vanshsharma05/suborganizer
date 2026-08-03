/**
 * The component vocabulary.
 *
 * Every screen is built from these and adds nothing of its own beyond layout, so
 * a change to how a button feels is one edit rather than eleven. The rules they
 * all follow are in theme.ts; the short version is that surfaces are lifted with
 * shadow rather than outlined, and coral is spent on one thing per screen.
 *
 * Anything that responds to a finger goes through `Press` from motion.tsx, so
 * touch feedback and haptics are uniform and cannot be forgotten.
 */

import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator, StyleSheet, Text, TextInput, View,
  type StyleProp, type ViewStyle,
} from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import Ionicons from '@expo/vector-icons/Ionicons';
import Animated, {
  FadeIn, useAnimatedStyle, useSharedValue, withSpring,
} from 'react-native-reanimated';
import { theme } from './theme';
import { Press } from './motion';
import type { Subscription } from './api';
import { fmtMoney } from './currency';

type Icon = keyof typeof Ionicons.glyphMap;

// ------------------------------------------------------------------ avatar --

// Only the three fields the avatar actually draws from, so callers holding
// something subscription-shaped — a Gmail scan candidate, say — can use it.
type Brandable = Pick<Subscription, 'name'> & Partial<Pick<Subscription, 'domain' | 'brand_color'>>;

export function BrandAvatar({ sub, size = 44 }: { sub: Brandable; size?: number }) {
  const initial = sub.name.charAt(0).toUpperCase();
  const bg = sub.brand_color || theme.color.brand;
  const [srcIdx, setSrcIdx] = useState(0);

  // Reset when the row shows a different brand. FlatList recycles this
  // component, so a domain that had exhausted its logo sources left the next
  // subscription stuck on its initial even though its own logo was fine.
  const [seenDomain, setSeenDomain] = useState(sub.domain);
  if (seenDomain !== sub.domain) {
    setSeenDomain(sub.domain);
    setSrcIdx(0);
  }

  // Google first, Clearbit second. Every miss costs a failed request and a
  // setState that re-renders the row, and Clearbit answers for far fewer domains
  // than it used to — leading with it meant a list of a dozen subscriptions
  // opened with a dozen doomed requests and a dozen re-renders before showing a
  // single logo. Google's favicon service resolves for essentially anything with
  // a website, so the common case is now one request and no re-render.
  const sources = sub.domain
    ? [
        `https://www.google.com/s2/favicons?domain=${sub.domain}&sz=128`,
        `https://logo.clearbit.com/${sub.domain}`,
      ]
    : [];

  const showFallback = !sub.domain || srcIdx >= sources.length;

  return (
    <View
      style={[
        avatarStyles.wrap,
        {
          width: size,
          height: size,
          // Squircle-ish. A radius near a third of the side is the shape both
          // app stores use for icons, so logos sit in it without looking cropped.
          borderRadius: size * 0.32,
          backgroundColor: showFallback ? bg : theme.color.raised,
        },
      ]}
    >
      {showFallback ? (
        <Text style={{ color: '#FFFFFF', fontSize: size * 0.4, fontWeight: '800' }}>{initial}</Text>
      ) : (
        <Image
          source={{ uri: sources[srcIdx] }}
          style={{ width: size * 0.72, height: size * 0.72, borderRadius: size * 0.2 }}
          contentFit="contain"
          transition={220}
          onError={() => setSrcIdx((i) => i + 1)}
          cachePolicy="memory-disk"
        />
      )}
    </View>
  );
}

const avatarStyles = StyleSheet.create({
  wrap: {
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    // No shadow here, deliberately. `overflow: hidden` plus a rounded shape plus
    // Android `elevation` forces an offscreen render pass, and this component
    // appears thirty times on a scrolling list — it was the single most
    // expensive thing on the Subs screen. The card underneath already supplies
    // the depth; a 44px tile does not need its own.
  },
});

// ----------------------------------------------------------------- buttons --

export type ButtonVariant = 'primary' | 'dark' | 'tinted' | 'ghost' | 'danger';

/**
 * The one button.
 *
 * Variants rather than separate components, because the moment there are three
 * button components there are three slightly different heights.
 */
export function Button({
  label, onPress, variant = 'primary', icon, iconAfter, loading, disabled, full = true, size = 'lg', testID, style,
}: {
  label: string;
  onPress: () => void;
  variant?: ButtonVariant;
  icon?: Icon;
  iconAfter?: Icon;
  loading?: boolean;
  disabled?: boolean;
  full?: boolean;
  size?: 'lg' | 'md' | 'sm';
  testID?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const height = size === 'lg' ? 56 : size === 'md' ? 46 : 38;
  const fontSize = size === 'lg' ? 15.5 : size === 'md' ? 14 : 13;
  const gradient =
    variant === 'primary' ? theme.color.coralGradient :
    variant === 'dark' ? theme.color.inkGradient : null;

  const flat =
    variant === 'tinted' ? theme.color.brandTint :
    variant === 'danger' ? theme.color.errorTint :
    'transparent';

  const fg =
    variant === 'primary' || variant === 'dark' ? '#FFFFFF' :
    variant === 'danger' ? theme.color.error :
    variant === 'tinted' ? theme.color.brandDeep :
    theme.color.ink;

  const inner = (
    <>
      {loading ? (
        <ActivityIndicator color={fg} size="small" />
      ) : (
        <>
          {icon && <Ionicons name={icon} size={fontSize + 3} color={fg} />}
          <Text style={[btn.label, { color: fg, fontSize }]} numberOfLines={1}>{label}</Text>
          {iconAfter && <Ionicons name={iconAfter} size={fontSize + 3} color={fg} />}
        </>
      )}
    </>
  );

  const shape: ViewStyle = {
    height,
    borderRadius: theme.radius.pill,
    paddingHorizontal: size === 'lg' ? 24 : 18,
    alignSelf: full ? 'stretch' : 'flex-start',
  };

  return (
    <Press
      onPress={onPress}
      disabled={disabled || loading}
      haptic={variant === 'primary' ? 'medium' : 'light'}
      testID={testID}
      style={[
        shape,
        variant === 'primary' ? theme.shadow.brand : undefined,
        style as ViewStyle,
      ]}
    >
      {gradient ? (
        <LinearGradient
          colors={gradient}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={[btn.inner, shape, { paddingHorizontal: 0 }]}
        >
          {inner}
        </LinearGradient>
      ) : (
        <View
          style={[
            btn.inner, shape, { paddingHorizontal: 0, backgroundColor: flat },
            variant === 'ghost' && { borderWidth: 1.5, borderColor: theme.color.borderStrong },
          ]}
        >
          {inner}
        </View>
      )}
    </Press>
  );
}

const btn = StyleSheet.create({
  inner: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  label: { fontWeight: '800', letterSpacing: -0.2 },
});

/** A circular icon-only control, for headers and row affordances. */
export function IconButton({
  icon, onPress, size = 40, tone = 'neutral', testID, style,
}: {
  icon: Icon;
  onPress: () => void;
  size?: number;
  tone?: 'neutral' | 'brand' | 'inverse';
  testID?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const bg =
    tone === 'brand' ? theme.color.brandTint :
    tone === 'inverse' ? theme.color.inverse :
    theme.color.raised;
  const fg =
    tone === 'brand' ? theme.color.brandDeep :
    tone === 'inverse' ? theme.color.onInverse :
    theme.color.ink;

  return (
    <Press onPress={onPress} testID={testID} scale={0.92} style={style as ViewStyle}>
      <View
        style={[
          {
            width: size, height: size, borderRadius: size / 2,
            backgroundColor: bg, alignItems: 'center', justifyContent: 'center',
          },
          tone === 'neutral' && theme.shadow.sm,
        ]}
      >
        <Ionicons name={icon} size={size * 0.46} color={fg} />
      </View>
    </Press>
  );
}

// ------------------------------------------------------------------- cards --

/** A lifted surface. Pressable when given `onPress`, inert otherwise. */
export function Card({
  children, onPress, style, padded = true, testID,
}: {
  children: React.ReactNode;
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
  padded?: boolean;
  testID?: string;
}) {
  const body = (
    <View style={[card.base, padded && { padding: 16 }, style]}>{children}</View>
  );

  if (!onPress) return <View testID={testID}>{body}</View>;
  return (
    <Press onPress={onPress} testID={testID} scale={0.985}>
      {body}
    </Press>
  );
}

const card = StyleSheet.create({
  base: {
    backgroundColor: theme.color.raised,
    borderRadius: theme.radius.lg,
    ...theme.shadow.md,
  },
});

// ------------------------------------------------------------------- chips --

export function Chip({
  label, active, onPress, icon, count, testID,
}: {
  label: string;
  active?: boolean;
  onPress?: () => void;
  icon?: Icon;
  count?: number;
  testID?: string;
}) {
  return (
    <Press onPress={onPress} testID={testID} scale={0.94} haptic="light">
      <View style={[chip.base, active && chip.active]}>
        {icon && (
          <Ionicons name={icon} size={13} color={active ? '#FFFFFF' : theme.color.inkSoft} />
        )}
        <Text style={[chip.label, active && chip.labelActive]} numberOfLines={1}>{label}</Text>
        {count !== undefined && count > 0 && (
          <View style={[chip.count, active && { backgroundColor: 'rgba(255,255,255,0.22)' }]}>
            <Text style={[chip.countText, active && { color: '#FFFFFF' }]}>{count}</Text>
          </View>
        )}
      </View>
    </Press>
  );
}

const chip = StyleSheet.create({
  base: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    height: 38, paddingHorizontal: 15, borderRadius: theme.radius.pill,
    backgroundColor: theme.color.raised, flexShrink: 0,
    // A hairline rather than elevation. There can be fifteen of these in a
    // horizontal scroller and at this size the border reads the same as the
    // shadow did, for none of the cost.
    borderWidth: 1, borderColor: theme.color.border,
  },
  active: { backgroundColor: theme.color.inverse, borderColor: theme.color.inverse },
  label: { color: theme.color.inkSoft, fontSize: 13, fontWeight: '700', letterSpacing: -0.1 },
  labelActive: { color: '#FFFFFF' },
  count: {
    minWidth: 19, height: 19, borderRadius: 10, paddingHorizontal: 5,
    backgroundColor: theme.color.surfaceSecondary,
    alignItems: 'center', justifyContent: 'center',
  },
  countText: { color: theme.color.inkSoft, fontSize: 10.5, fontWeight: '800' },
});

/** Small status marker. Never interactive — that is what Chip is for. */
export function Badge({
  label, tone = 'neutral', icon,
}: {
  label: string;
  tone?: 'neutral' | 'success' | 'warning' | 'danger' | 'brand' | 'teal';
  icon?: Icon;
}) {
  const map = {
    neutral: [theme.color.surfaceSecondary, theme.color.inkSoft],
    success: [theme.color.successTint, theme.color.success],
    warning: [theme.color.warningTint, theme.color.warning],
    danger: [theme.color.errorTint, theme.color.error],
    brand: [theme.color.brandTint, theme.color.brandDeep],
    teal: [theme.color.brandSecondaryTint, theme.color.brandSecondaryDeep],
  } as const;
  const [bg, fg] = map[tone];

  return (
    <View style={[badge.base, { backgroundColor: bg }]}>
      {icon && <Ionicons name={icon} size={11} color={fg} />}
      <Text style={[badge.text, { color: fg }]} numberOfLines={1}>{label}</Text>
    </View>
  );
}

const badge = StyleSheet.create({
  base: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 9, paddingVertical: 4.5, borderRadius: theme.radius.pill,
    alignSelf: 'flex-start',
  },
  text: { fontSize: 10.5, fontWeight: '800', letterSpacing: 0.2 },
});

// ------------------------------------------------------------------ inputs --

/**
 * Search.
 *
 * Filled rather than outlined, and the clear button only exists when there is
 * something to clear — a permanently visible × on an empty field is noise that
 * teaches the eye to ignore that corner.
 */
export function SearchField({
  value, onChange, placeholder = 'Search', autoFocus, testID,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
  testID?: string;
}) {
  const [focused, setFocused] = useState(false);

  return (
    <View style={[field.search, focused && field.searchFocused]}>
      <Ionicons
        name="search"
        size={17}
        color={focused ? theme.color.brandPrimary : theme.color.inkMuted}
      />
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={theme.color.inkMuted}
        style={field.searchInput}
        autoCapitalize="none"
        autoCorrect={false}
        autoFocus={autoFocus}
        returnKeyType="search"
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        testID={testID}
      />
      {value.length > 0 && (
        <Animated.View entering={FadeIn.duration(140)}>
          <Press onPress={() => onChange('')} scale={0.85} testID="search-clear">
            <Ionicons name="close-circle" size={18} color={theme.color.inkMuted} />
          </Press>
        </Animated.View>
      )}
    </View>
  );
}

/** Labelled text input. */
export function Field({
  label, value, onChangeText, placeholder, keyboardType, secureTextEntry, autoCapitalize,
  prefix, multiline, testID, error,
}: {
  label: string;
  value: string;
  onChangeText: (v: string) => void;
  placeholder?: string;
  keyboardType?: 'default' | 'numeric' | 'email-address' | 'decimal-pad';
  secureTextEntry?: boolean;
  autoCapitalize?: 'none' | 'words' | 'sentences';
  prefix?: string;
  multiline?: boolean;
  testID?: string;
  error?: string;
}) {
  const [focused, setFocused] = useState(false);

  return (
    <View style={{ gap: 7 }}>
      <Text style={field.label}>{label}</Text>
      <View
        style={[
          field.box,
          focused && field.boxFocused,
          error !== undefined && { borderColor: theme.color.error },
          multiline === true && { height: 96, alignItems: 'flex-start', paddingTop: 14 },
        ]}
      >
        {prefix !== undefined && <Text style={field.prefix}>{prefix}</Text>}
        <TextInput
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={theme.color.inkMuted}
          keyboardType={keyboardType}
          secureTextEntry={secureTextEntry}
          autoCapitalize={autoCapitalize}
          multiline={multiline}
          style={[field.input, multiline === true && { height: '100%', textAlignVertical: 'top' }]}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          testID={testID}
        />
      </View>
      {error !== undefined && <Text style={field.error}>{error}</Text>}
    </View>
  );
}

const field = StyleSheet.create({
  search: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    height: 48, paddingHorizontal: 16, borderRadius: theme.radius.pill,
    backgroundColor: theme.color.raised,
    borderWidth: 1.5, borderColor: 'transparent',
    ...theme.shadow.sm,
  },
  searchFocused: { borderColor: theme.color.brand },
  searchInput: {
    flex: 1, color: theme.color.ink, fontSize: 15, fontWeight: '600',
    padding: 0, includeFontPadding: false,
  },

  label: { ...theme.type.overline, color: theme.color.inkMuted },
  box: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    height: 54, paddingHorizontal: 16, borderRadius: theme.radius.md,
    backgroundColor: theme.color.raised,
    borderWidth: 1.5, borderColor: theme.color.border,
  },
  boxFocused: { borderColor: theme.color.brand },
  prefix: { color: theme.color.inkMuted, fontSize: 16, fontWeight: '700' },
  input: {
    flex: 1, color: theme.color.ink, fontSize: 16, fontWeight: '600',
    padding: 0, includeFontPadding: false,
  },
  error: { color: theme.color.error, ...theme.type.caption },
});

/** Two-to-four exclusive options. Wider than that, use Chips. */
/**
 * A choice between two and four things, with one indicator that travels.
 *
 * The version this replaced gave every option its own background and switched
 * it instantly, so choosing felt like a checkbox rather than a control — and
 * pressing scaled the individual segment down, which made a fixed track look
 * like it was made of loose buttons. A single pill that springs to where you
 * tapped is what tells you the options are one thing with one answer.
 *
 * Label colour crossfades on the same spring, so the text is never dark ink on
 * a dark pill part-way through the journey.
 */
export function Segmented<T extends string>({
  options, value, onChange, tone = 'paper', testID,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  /**
   * `onBrand` is the same control sitting on the coral gradient, where a paper
   * track disappears and dark ink is unreadable. Sign-in used to hand-roll its
   * own version for this reason, which is how it ended up the only segmented
   * control in the app that never animated.
   */
  tone?: 'paper' | 'onBrand';
  testID?: string;
}) {
  const [rowWidth, setRowWidth] = useState(0);
  const index = Math.max(0, options.findIndex((o) => o.value === value));
  const slot = rowWidth > 0 ? rowWidth / options.length : 0;

  const x = useSharedValue(0);
  const placed = useRef(false);

  useEffect(() => {
    if (slot === 0) return;
    const target = index * slot;
    // The first placement is a fact, not a transition — otherwise the pill
    // slides in from the left every time the screen mounts.
    if (!placed.current) {
      placed.current = true;
      x.value = target;
      return;
    }
    x.value = withSpring(target, theme.motion.enter);
  }, [index, slot, x]);

  const pill = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }] }));

  const dark = tone === 'onBrand';

  return (
    <View style={[seg.track, dark && seg.trackOnBrand]} testID={testID}>
      <View style={seg.row} onLayout={(e) => setRowWidth(e.nativeEvent.layout.width)}>
        {slot > 0 && (
          <Animated.View
            style={[
              seg.pill,
              dark && seg.pillOnBrand,
              { width: slot - SEG_INSET * 2, left: SEG_INSET },
              pill,
            ]}
            pointerEvents="none"
          />
        )}

        {options.map((o) => (
          <SegItem
            key={o.value}
            label={o.label}
            active={o.value === value}
            dark={dark}
            onPress={() => onChange(o.value)}
            testID={`${testID ?? 'seg'}-${o.value}`}
          />
        ))}
      </View>
    </View>
  );
}

function SegItem({
  label, active, dark, onPress, testID,
}: {
  label: string; active: boolean; dark: boolean; onPress: () => void; testID: string;
}) {
  const on = useSharedValue(active ? 1 : 0);

  useEffect(() => {
    on.value = withSpring(active ? 1 : 0, theme.motion.enter);
  }, [active, on]);

  // Two labels crossfading rather than one changing colour, for the same reason
  // the tab bar stacks two icons: the pill is elsewhere for part of the trip.
  const off = useAnimatedStyle(() => ({ opacity: 1 - on.value }));
  const lit = useAnimatedStyle(() => ({ opacity: on.value }));

  return (
    <Press
      onPress={onPress}
      scale={1}
      haptic="selection"
      style={seg.item}
      accessibilityLabel={label}
      testID={testID}
    >
      <View style={seg.itemInner}>
        <Animated.Text
          style={[seg.label, dark && seg.labelOnBrand, off]}
          numberOfLines={1}
        >
          {label}
        </Animated.Text>
        <Animated.Text
          style={[
            seg.label, seg.labelActive, dark && seg.labelActiveOnBrand, seg.labelOverlay, lit,
          ]}
          numberOfLines={1}
        >
          {label}
        </Animated.Text>
      </View>
    </Press>
  );
}

/** Breathing room between the travelling pill and the edge of its slot. */
const SEG_INSET = 3;

const seg = StyleSheet.create({
  track: {
    padding: 4,
    backgroundColor: theme.color.surfaceSecondary,
    borderRadius: theme.radius.pill,
  },
  trackOnBrand: { backgroundColor: 'rgba(0,0,0,0.22)' },
  row: { flexDirection: 'row' },
  pill: {
    position: 'absolute', top: 0, height: 40,
    borderRadius: theme.radius.pill,
    backgroundColor: theme.color.raised,
    ...theme.shadow.sm,
  },
  item: { flex: 1 },
  itemInner: { height: 40, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 },
  label: {
    color: theme.color.inkSoft, fontSize: 13, fontWeight: '700',
    letterSpacing: -0.1, textAlign: 'center',
  },
  pillOnBrand: { backgroundColor: '#FFFFFF' },
  labelOnBrand: { color: 'rgba(255,255,255,0.82)' },
  labelActive: { color: theme.color.ink, fontWeight: '800' },
  // Only on the gradient, where the pill is pure white and coral is the
  // legible contrast. On paper the active label stays ink, so a segmented
  // control never spends the screen's one accent on itself.
  labelActiveOnBrand: { color: theme.color.brandDeep },
  labelOverlay: { position: 'absolute', left: 6, right: 6 },
});

// ------------------------------------------------------------------ layout --

export function SectionHeader({
  title, action, onAction, count,
}: {
  title: string;
  action?: string;
  onAction?: () => void;
  count?: number;
}) {
  return (
    <View style={section.row}>
      <Text style={section.title}>{title}</Text>
      {/* A count of nothing is not information. The section under it already
          says so, in words. */}
      {count !== undefined && count > 0 && <Text style={section.count}>{count}</Text>}
      <View style={{ flex: 1 }} />
      {action !== undefined && onAction !== undefined && (
        <Press onPress={onAction} scale={0.94}>
          <Text style={section.action}>{action}</Text>
        </Press>
      )}
    </View>
  );
}

const section = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 },
  title: { ...theme.type.title3, color: theme.color.ink },
  count: {
    ...theme.type.caption, color: theme.color.inkMuted, fontWeight: '800',
    backgroundColor: theme.color.surfaceSecondary,
    paddingHorizontal: 7, paddingVertical: 2, borderRadius: theme.radius.pill,
    overflow: 'hidden',
  },
  action: { color: theme.color.brandPrimary, fontSize: 13, fontWeight: '800' },
});

/** The state a list is in before it has anything to show. */
export function EmptyState({
  icon, title, body, actionLabel, onAction, tone = 'brand', testID,
}: {
  icon: Icon;
  title: string;
  body: string;
  actionLabel?: string;
  onAction?: () => void;
  tone?: 'brand' | 'teal' | 'neutral';
  testID?: string;
}) {
  const fg =
    tone === 'teal' ? theme.color.brandSecondary :
    tone === 'neutral' ? theme.color.inkMuted :
    theme.color.brandPrimary;
  const bg =
    tone === 'teal' ? theme.color.brandSecondaryTint :
    tone === 'neutral' ? theme.color.surfaceSecondary :
    theme.color.brandTint;

  return (
    <View style={empty.wrap} testID={testID}>
      <View style={[empty.icon, { backgroundColor: bg }]}>
        <Ionicons name={icon} size={28} color={fg} />
      </View>
      <Text style={empty.title}>{title}</Text>
      <Text style={empty.body}>{body}</Text>
      {actionLabel !== undefined && onAction !== undefined && (
        <Button label={actionLabel} onPress={onAction} full={false} size="md" style={{ marginTop: 6 }} />
      )}
    </View>
  );
}

const empty = StyleSheet.create({
  wrap: { alignItems: 'center', gap: 10, paddingHorizontal: 36, paddingVertical: 44 },
  icon: { width: 64, height: 64, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  title: { ...theme.type.title3, color: theme.color.ink, marginTop: 4 },
  body: { ...theme.type.body, color: theme.color.inkSoft, textAlign: 'center' },
});

/** A label above a figure. The unit of every stats row in the app. */
export function Stat({
  label, value, tone, style,
}: {
  label: string;
  value: string;
  tone?: 'brand' | 'teal';
  style?: StyleProp<ViewStyle>;
}) {
  const fg =
    tone === 'brand' ? theme.color.brandPrimary :
    tone === 'teal' ? theme.color.brandSecondary :
    theme.color.ink;

  return (
    <View style={[stat.wrap, style]}>
      {/* No adjustsFontSizeToFit: it re-measures the text on every layout pass
          to find a size that fits, and three of these in a row made every
          re-render of the screen do binary-search text measurement. */}
      <Text style={[stat.value, { color: fg }]} numberOfLines={1}>
        {value}
      </Text>
      <Text style={stat.label} numberOfLines={1}>{label}</Text>
    </View>
  );
}

const stat = StyleSheet.create({
  wrap: {
    flex: 1, backgroundColor: theme.color.raised, borderRadius: theme.radius.md,
    paddingVertical: 14, paddingHorizontal: 14, ...theme.shadow.sm,
  },
  value: { fontSize: 21, fontWeight: '800', letterSpacing: -0.7 },
  label: { ...theme.type.caption, color: theme.color.inkMuted, marginTop: 2 },
});

export function formatMoney(n: number, currency?: string): string {
  return fmtMoney(n, currency);
}

export function formatMoneyRounded(n: number, currency?: string): string {
  return fmtMoney(n, currency, { compact: true });
}

export type { Icon };
