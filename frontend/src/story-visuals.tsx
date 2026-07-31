/**
 * The moving parts of the story.
 *
 * Kept out of app/story.tsx so that file stays about sequence and this one stays
 * about motion. Two rules hold throughout:
 *
 *   Everything is driven by scroll position, not by mount. An entrance animation
 *   fires once and is gone; tying motion to the pager means the story reacts
 *   continuously to the user's thumb, which is what separates something that
 *   feels alive from a slideshow with fades on it.
 *
 *   Every worklet here does arithmetic on shared values and nothing else. They
 *   run on the UI thread, where imported JS helpers do not exist — calling one
 *   is the crash that took out the launch animation once already.
 */

import React, { useEffect } from 'react';
import { StyleSheet, Text, View, useWindowDimensions } from 'react-native';
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
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import Svg, { Circle } from 'react-native-svg';

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

/** How far a layer lags the swipe. 0 moves with the page, 1 lags a full width. */
export type Depth = number;

/**
 * Moves its children at a different rate from the page itself.
 *
 * Foreground text takes a small depth and background ornament a large one, which
 * is what produces the sense that the slide has thickness rather than being a
 * flat card sliding past.
 */
export function Parallax({
  scrollX,
  index,
  depth = 0.35,
  fade = true,
  children,
  style,
}: {
  scrollX: SharedValue<number>;
  index: number;
  depth?: Depth;
  fade?: boolean;
  children: React.ReactNode;
  style?: object;
}) {
  const { width } = useWindowDimensions();

  const animated = useAnimatedStyle(() => {
    const offset = scrollX.value - index * width;
    const progress = offset / width; // -1 before, 0 on screen, 1 after

    return {
      transform: [
        { translateX: -progress * width * depth },
        { scale: interpolate(Math.abs(progress), [0, 1], [1, 0.86], Extrapolation.CLAMP) },
      ],
      opacity: fade
        ? interpolate(Math.abs(progress), [0, 0.75], [1, 0], Extrapolation.CLAMP)
        : 1,
    };
  });

  return <Animated.View style={[style, animated]}>{children}</Animated.View>;
}

/**
 * Two soft shapes drifting behind everything, at the slowest depth.
 *
 * The gradient alone is flat once it has been on screen for a second. These give
 * the eye something that is still moving while the user reads.
 */
export function DriftingBlobs({ scrollX }: { scrollX: SharedValue<number> }) {
  const { width, height } = useWindowDimensions();
  const drift = useSharedValue(0);

  useEffect(() => {
    drift.value = withRepeat(
      withTiming(1, { duration: 9000, easing: Easing.inOut(Easing.sin) }),
      -1,
      true,
    );
  }, [drift]);

  const a = useAnimatedStyle(() => ({
    transform: [
      { translateX: -scrollX.value * 0.12 + drift.value * 26 },
      { translateY: drift.value * -34 },
      { scale: 1 + drift.value * 0.08 },
    ],
  }));

  const b = useAnimatedStyle(() => ({
    transform: [
      { translateX: -scrollX.value * 0.2 - drift.value * 40 },
      { translateY: drift.value * 30 },
      { scale: 1.1 - drift.value * 0.1 },
    ],
  }));

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <Animated.View
        style={[
          blob.base,
          { width: width * 0.9, height: width * 0.9, top: -width * 0.25, left: -width * 0.2 },
          a,
        ]}
      />
      <Animated.View
        style={[
          blob.base,
          { width: width * 1.1, height: width * 1.1, top: height * 0.55, left: width * 0.25 },
          b,
        ]}
      />
    </View>
  );
}

const blob = StyleSheet.create({
  base: {
    position: 'absolute',
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.09)',
  },
});

/**
 * Horizontal bars that grow from nothing when the slide arrives.
 *
 * The point of showing a total next to its parts is that "₹4,842" is a fact and
 * "₹4,842, most of it entertainment" is a realisation.
 */
export function CategoryBars({
  data,
  active,
  currency,
  format,
}: {
  data: { key: string; value: number; color: string }[];
  active: boolean;
  currency: string;
  format: (n: number, c: string) => string;
}) {
  const max = Math.max(...data.map((d) => d.value), 1);

  return (
    <View style={bars.wrap}>
      {data.map((d, i) => (
        <Bar
          key={d.key}
          label={d.key}
          amount={format(d.value, currency)}
          fraction={d.value / max}
          color={d.color}
          delay={i * 90}
          active={active}
        />
      ))}
    </View>
  );
}

function Bar({
  label, amount, fraction, color, delay, active,
}: {
  label: string; amount: string; fraction: number; color: string; delay: number; active: boolean;
}) {
  const grow = useSharedValue(0);

  useEffect(() => {
    grow.value = active
      ? withDelay(delay, withTiming(1, { duration: 850, easing: Easing.out(Easing.cubic) }))
      : 0;
  }, [active, delay, grow]);

  const fill = useAnimatedStyle(() => ({
    width: `${grow.value * fraction * 100}%`,
    opacity: interpolate(grow.value, [0, 0.15, 1], [0, 1, 1], Extrapolation.CLAMP),
  }));

  const row = useAnimatedStyle(() => ({
    opacity: grow.value,
    transform: [{ translateX: (1 - grow.value) * -18 }],
  }));

  return (
    <Animated.View style={row}>
      <View style={bars.head}>
        <Text style={bars.label} numberOfLines={1}>{label}</Text>
        <Text style={bars.amount}>{amount}</Text>
      </View>
      <View style={bars.track}>
        <Animated.View style={[bars.fill, { backgroundColor: color }, fill]} />
      </View>
    </Animated.View>
  );
}

const bars = StyleSheet.create({
  wrap: { gap: 13, marginTop: 24, alignSelf: 'stretch' },
  head: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 },
  label: { color: 'rgba(255,255,255,0.9)', fontSize: 13.5, fontWeight: '700', flex: 1 },
  amount: { color: '#FFFFFF', fontSize: 13.5, fontWeight: '800' },
  track: {
    height: 9, borderRadius: 5,
    backgroundColor: 'rgba(0,0,0,0.18)', overflow: 'hidden',
  },
  fill: { height: '100%', borderRadius: 5 },
});

/**
 * Twelve squares, one per month, filling one after another.
 *
 * Turning "×12" from an arithmetic step into something the eye watches happen is
 * the whole reason the annual figure lands harder than the monthly one.
 */
export function MonthGrid({ active }: { active: boolean }) {
  return (
    <View style={grid.wrap}>
      {Array.from({ length: 12 }, (_, i) => (
        <MonthCell key={i} delay={i * 70} active={active} />
      ))}
    </View>
  );
}

function MonthCell({ delay, active }: { delay: number; active: boolean }) {
  const pop = useSharedValue(0);

  useEffect(() => {
    pop.value = active
      ? withDelay(
          delay,
          withSequence(
            withTiming(1.18, { duration: 190, easing: Easing.out(Easing.quad) }),
            withTiming(1, { duration: 170, easing: Easing.inOut(Easing.quad) }),
          ),
        )
      : 0;
  }, [active, delay, pop]);

  const style = useAnimatedStyle(() => ({
    opacity: interpolate(pop.value, [0, 0.3, 1], [0.15, 1, 1], Extrapolation.CLAMP),
    transform: [{ scale: interpolate(pop.value, [0, 1.18], [0.5, 1], Extrapolation.CLAMP) }],
  }));

  return <Animated.View style={[grid.cell, style]} />;
}

const grid = StyleSheet.create({
  wrap: {
    flexDirection: 'row', flexWrap: 'wrap', gap: 9,
    marginTop: 26, maxWidth: 260,
  },
  cell: {
    width: 46, height: 46, borderRadius: 13,
    backgroundColor: 'rgba(255,255,255,0.92)',
  },
});

/**
 * A ring that draws itself to show one subscription's share of the total.
 *
 * "Netflix, ₹649" says nothing about whether that is a lot. "Netflix, a fifth of
 * everything you spend" is the same number and an actual judgement.
 */
export function ShareRing({
  fraction, active, size = 132, label,
}: {
  fraction: number; active: boolean; size?: number; label: string;
}) {
  const stroke = 13;
  const r = (size - stroke) / 2;
  const circumference = 2 * Math.PI * r;
  const draw = useSharedValue(0);

  useEffect(() => {
    draw.value = active
      ? withDelay(260, withTiming(1, { duration: 1100, easing: Easing.out(Easing.cubic) }))
      : 0;
  }, [active, draw]);

  const animated = useAnimatedProps(() => ({
    strokeDashoffset: circumference * (1 - draw.value * fraction),
  }));

  const text = useAnimatedStyle(() => ({ opacity: draw.value }));

  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={size} height={size} style={StyleSheet.absoluteFill}>
        <Circle
          cx={size / 2} cy={size / 2} r={r}
          stroke="rgba(0,0,0,0.18)" strokeWidth={stroke} fill="none"
        />
        <AnimatedCircle
          cx={size / 2} cy={size / 2} r={r}
          stroke="#FFFFFF" strokeWidth={stroke} fill="none"
          strokeLinecap="round"
          strokeDasharray={circumference}
          // Start at twelve o'clock rather than three.
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
          animatedProps={animated}
        />
      </Svg>
      <Animated.Text style={[ring.label, text]}>{label}</Animated.Text>
    </View>
  );
}

const ring = StyleSheet.create({
  label: { color: '#FFFFFF', fontSize: 26, fontWeight: '800', letterSpacing: -0.8 },
});

// Pulse used to live here too. It moved to motion.tsx when the rest of the app
// needed it — two copies of the same breath drifting apart is exactly the thing
// the shared motion module exists to prevent.
