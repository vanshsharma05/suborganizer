/**
 * Motion primitives.
 *
 * Every animation in the app is assembled from these, for one reason: an
 * interface feels like a single piece of software when everything moves on the
 * same curves, and like a pile of screens when each one improvises. The curves
 * live in `theme.motion` and nothing here invents its own.
 *
 * Two things worth knowing before editing:
 *
 *   Worklets cannot call imported JS. Anything inside `useAnimatedStyle` or
 *   `useAnimatedProps` runs on the UI thread, where the module graph does not
 *   exist. `groupDigits` below is marked `'worklet'` and duplicates logic from
 *   currency.ts for exactly this reason — not an oversight.
 *
 *   Counting numbers never touch React state. The obvious implementation —
 *   requestAnimationFrame plus setState — re-renders a component sixty times a
 *   second and drops frames the moment anything else is happening, which is
 *   precisely when a number is usually counting. `CountUp` writes into a
 *   TextInput's `text` prop from the UI thread instead, so the JS thread is free.
 */

import React, { useEffect } from 'react';
import {
  Pressable, StyleSheet, TextInput, View, type StyleProp, type ViewStyle,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import Animated, {
  Easing,
  Extrapolation,
  interpolate,
  useAnimatedProps,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import { theme } from './theme';

const AnimatedTextInput = Animated.createAnimatedComponent(TextInput);

/**
 * Haptics that can never take the app down.
 *
 * A synchronous throw, not just a rejected promise: on a dev client built before
 * expo-haptics was added, the native module is missing and calling into it
 * throws immediately — which a trailing `.catch` does not cover. Every button in
 * the app goes through here, so getting that wrong is a white screen rather than
 * a missing buzz.
 */
export function tapFeedback(kind: 'light' | 'medium' | 'selection'): void {
  try {
    if (kind === 'selection') void Haptics.selectionAsync().catch(() => {});
    else {
      void Haptics.impactAsync(
        kind === 'medium' ? Haptics.ImpactFeedbackStyle.Medium : Haptics.ImpactFeedbackStyle.Light,
      ).catch(() => {});
    }
  } catch {
    // No motor, no module, or the OS declined. Purely decorative.
  }
}

// ------------------------------------------------------------------- press --

/**
 * The standard touch response: a small, fast scale-down and a tick of haptic.
 *
 * The scale is deliberately slight. Anything past about 4% reads as the button
 * being pushed away rather than pressed, and on a large card it looks like the
 * layout is collapsing. Haptics fire on press-in, not on release, because the
 * point is to confirm the touch registered — by release the user already knows.
 */
export function Press({
  onPress,
  children,
  style,
  scale = 0.97,
  haptic = 'light',
  disabled,
  hitSlop,
  accessibilityLabel,
  testID,
}: {
  onPress?: () => void;
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  scale?: number;
  /** `selection` is the flick a toggle should give — lighter than a tap on a button. */
  haptic?: 'light' | 'medium' | 'selection' | 'none';
  disabled?: boolean;
  /**
   * Extra touchable area outside the drawn bounds.
   *
   * Some controls should not be 44pt of ink — a dismiss cross that big would
   * dominate the row it sits in. This lets the target be the right size without
   * the button having to be.
   */
  hitSlop?: number;
  /** Needed wherever the child is an icon, since there is no text to read out. */
  accessibilityLabel?: string;
  testID?: string;
}) {
  const pressed = useSharedValue(0);

  const animated = useAnimatedStyle(() => ({
    transform: [{ scale: interpolate(pressed.value, [0, 1], [1, scale], Extrapolation.CLAMP) }],
  }));

  const tap = () => {
    if (haptic !== 'none') tapFeedback(haptic);
    pressed.value = withSpring(1, theme.motion.press);
  };

  /*
   * How this control sits in its parent, lifted onto the Pressable.
   *
   * `style` goes on the animated view inside, because that is the thing being
   * scaled. But the Pressable is what the parent actually lays out, so a
   * `flex: 1` meant for a row never reached anything — the Pressable sized
   * itself to its text and the caller got a control that would not share the
   * row. Invisible in a column, where children stretch by default, and the
   * reason a segmented control's slots bunched to one side.
   *
   * Only the properties that decide participation in the parent's layout are
   * copied up. Everything visual stays inside, where it already worked, and
   * applying these in both places is harmless — the inner view simply fills
   * the box the outer one won.
   */
  const flat = StyleSheet.flatten(style) ?? {};
  const outer: ViewStyle = {
    flex: flat.flex,
    flexGrow: flat.flexGrow,
    flexShrink: flat.flexShrink,
    flexBasis: flat.flexBasis,
    alignSelf: flat.alignSelf,
    width: flat.width,
    minWidth: flat.minWidth,
    maxWidth: flat.maxWidth,
  };

  return (
    <Pressable
      style={outer}
      onPressIn={tap}
      onPressOut={() => {
        pressed.value = withSpring(0, theme.motion.press);
      }}
      onPress={onPress}
      disabled={disabled}
      hitSlop={hitSlop}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled: disabled === true }}
      testID={testID}
    >
      <Animated.View style={[style, animated, disabled === true && { opacity: 0.45 }]}>
        {children}
      </Animated.View>
    </Pressable>
  );
}

// ---------------------------------------------------------------- entrance --

/**
 * Fades and lifts its children in, optionally on a stagger.
 *
 * `index` multiplies the stagger delay, so a list maps straight onto it and
 * arrives as a cascade. Capped at ten because past roughly half a second of
 * total stagger the last item reads as broken rather than choreographed.
 */
export function Reveal({
  children,
  index = 0,
  delay = 0,
  distance = 18,
  style,
  testID,
}: {
  children: React.ReactNode;
  index?: number;
  delay?: number;
  distance?: number;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}) {
  const v = useSharedValue(0);
  const wait = delay + Math.min(index, 10) * theme.motion.stagger;

  useEffect(() => {
    v.value = withDelay(wait, withSpring(1, theme.motion.enter));
  }, [v, wait]);

  const animated = useAnimatedStyle(() => ({
    opacity: interpolate(v.value, [0, 0.6], [0, 1], Extrapolation.CLAMP),
    transform: [{ translateY: (1 - v.value) * distance }],
  }));

  return <Animated.View style={[style, animated]} testID={testID}>{children}</Animated.View>;
}

// ------------------------------------------------------------------ counts --

/**
 * Groups digits the way the currency expects. Indian numbering puts the last
 * three together and then pairs — 12,34,567, not 1,234,567 — and getting that
 * wrong in an India-first app is immediately visible to every user.
 */
// Exported so a caller can measure what CountUp is about to draw and size the
// text to fit it. It is a worklet, but an ordinary function too — calling it
// from the JS thread to count characters is fine.
export function groupDigits(value: number, indian: boolean): string {
  'worklet';
  const negative = value < 0;
  const digits = String(Math.abs(Math.round(value)));

  let out = '';
  if (indian && digits.length > 3) {
    const head = digits.slice(0, digits.length - 3);
    let paired = '';
    for (let i = head.length; i > 0; i -= 2) {
      const chunk = head.slice(Math.max(0, i - 2), i);
      paired = paired ? `${chunk},${paired}` : chunk;
    }
    out = `${paired},${digits.slice(-3)}`;
  } else {
    for (let i = digits.length; i > 0; i -= 3) {
      const chunk = digits.slice(Math.max(0, i - 3), i);
      out = out ? `${chunk},${out}` : chunk;
    }
  }

  return negative ? `-${out}` : out;
}

/**
 * A figure that counts up to its value, entirely on the UI thread.
 *
 * Quartic-out: fast enough never to feel like waiting, slow enough at the tail
 * that the final digits are readable as they land. `active` gates it so a number
 * three screens away in a pager has not already finished by the time it is seen.
 */
export function CountUp({
  value,
  symbol,
  indian = true,
  active = true,
  style,
  duration = theme.motion.duration.count,
  testID,
}: {
  value: number;
  symbol: string;
  indian?: boolean;
  active?: boolean;
  style?: object | object[];
  duration?: number;
  testID?: string;
}) {
  const progress = useSharedValue(0);
  const target = useSharedValue(value);

  useEffect(() => {
    target.value = value;
    if (!active) {
      progress.value = 0;
      return;
    }
    progress.value = 0;
    progress.value = withTiming(1, { duration, easing: Easing.out(Easing.poly(4)) });
  }, [value, active, duration, progress, target]);

  const animated = useAnimatedProps(() => ({
    text: `${symbol}${groupDigits(target.value * progress.value, indian)}`,
    defaultValue: `${symbol}${groupDigits(target.value * progress.value, indian)}`,
  })) as never;

  return (
    <AnimatedTextInput
      // A number wearing a TextInput, because that is the only node whose
      // contents can be written from the UI thread. Everything below exists to
      // stop it behaving like an input: without them Android lets you long-press
      // the headline figure and offers to cut and paste it.
      editable={false}
      selectTextOnFocus={false}
      contextMenuHidden
      caretHidden
      focusable={false}
      showSoftInputOnFocus={false}
      pointerEvents="none"
      underlineColorAndroid="transparent"
      style={[countStyles.base, style]}
      animatedProps={animated}
      testID={testID}
      accessibilityRole="text"
    />
  );
}

const countStyles = StyleSheet.create({
  base: { padding: 0, margin: 0, includeFontPadding: false, textAlignVertical: 'center' },
});

// ----------------------------------------------------------------- ambient --

/** A slow breath, for anything with a deadline or an unread state attached. */
export function Pulse({
  children,
  active = true,
  amount = 0.045,
}: {
  children: React.ReactNode;
  active?: boolean;
  amount?: number;
}) {
  const beat = useSharedValue(0);

  useEffect(() => {
    beat.value = active
      ? withRepeat(withTiming(1, { duration: 1400, easing: Easing.inOut(Easing.quad) }), -1, true)
      : 0;
  }, [active, beat]);

  const style = useAnimatedStyle(() => ({
    transform: [{ scale: 1 + beat.value * amount }],
  }));

  return <Animated.View style={style}>{children}</Animated.View>;
}

/**
 * Loading placeholder.
 *
 * A sweep of light across a neutral block, which reads as "this is arriving"
 * where a spinner reads as "this is stuck". Sized by the caller so the skeleton
 * matches the shape of whatever replaces it — the layout should not jump when
 * the real content lands.
 */
export function Skeleton({
  width,
  height,
  radius = theme.radius.md,
  style,
}: {
  width: number | `${number}%`;
  height: number;
  radius?: number;
  style?: ViewStyle;
}) {
  const sweep = useSharedValue(0);

  useEffect(() => {
    sweep.value = withRepeat(
      withSequence(
        withTiming(1, { duration: 1100, easing: Easing.inOut(Easing.quad) }),
        withTiming(0, { duration: 0 }),
      ),
      -1,
    );
  }, [sweep]);

  const shine = useAnimatedStyle(() => ({
    opacity: interpolate(sweep.value, [0, 0.5, 1], [0, 0.55, 0], Extrapolation.CLAMP),
    transform: [{ translateX: interpolate(sweep.value, [0, 1], [-90, 90]) }],
  }));

  return (
    <View
      style={[
        { width, height, borderRadius: radius, backgroundColor: theme.color.surfaceSecondary, overflow: 'hidden' },
        style,
      ]}
    >
      <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: '#FFFFFF' }, shine]} />
    </View>
  );
}

/**
 * A bar that grows to `fraction` of its track.
 *
 * Used everywhere a proportion is shown, so that proportions all animate the
 * same way whether they are a category share or a trial countdown.
 */
export function Meter({
  fraction,
  color,
  height = 8,
  delay = 0,
  track = 'rgba(19,21,24,0.07)',
}: {
  fraction: number;
  color: string;
  height?: number;
  delay?: number;
  track?: string;
}) {
  const grow = useSharedValue(0);

  useEffect(() => {
    grow.value = withDelay(delay, withSpring(1, theme.motion.travel));
  }, [grow, delay, fraction]);

  const fill = useAnimatedStyle(() => ({
    width: `${Math.max(0, Math.min(1, fraction)) * grow.value * 100}%`,
  }));

  return (
    <View style={{ height, borderRadius: height / 2, backgroundColor: track, overflow: 'hidden' }}>
      <Animated.View
        style={[{ height: '100%', borderRadius: height / 2, backgroundColor: color }, fill]}
      />
    </View>
  );
}

/**
 * Collapses a header as the page scrolls.
 *
 * Returns the style rather than a component so the caller keeps control of what
 * shrinks — usually a title that fades while a compact one fades in behind it.
 */
export function useCollapsingHeader(scrollY: SharedValue<number>, range = 90) {
  const big = useAnimatedStyle(() => ({
    opacity: interpolate(scrollY.value, [0, range * 0.7], [1, 0], Extrapolation.CLAMP),
    transform: [
      { translateY: interpolate(scrollY.value, [0, range], [0, -18], Extrapolation.CLAMP) },
      { scale: interpolate(scrollY.value, [0, range], [1, 0.94], Extrapolation.CLAMP) },
    ],
  }));

  const compact = useAnimatedStyle(() => ({
    opacity: interpolate(scrollY.value, [range * 0.55, range], [0, 1], Extrapolation.CLAMP),
    transform: [
      { translateY: interpolate(scrollY.value, [range * 0.55, range], [10, 0], Extrapolation.CLAMP) },
    ],
  }));

  return { big, compact };
}
