import React, { useEffect, useRef, useState } from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withTiming,
} from 'react-native-reanimated';
import { theme } from './theme';

/**
 * Launch animation that plays directly after the native splash.
 *
 * It plays in full exactly once. A brand animation is a pleasure the first time
 * and a toll every time after — this app is opened to check a number, and 1.75
 * seconds of unskippable logo before you can touch anything is a real cost paid
 * on every single launch. So the introduction happens once, and returning users
 * get the same mark and the same motion in about a third of the time.
 *
 * First launch (~1.75s):
 *   0ms     cream field, coral diamond at rest — pixel-matched to the native
 *           splash so the handoff between the two is invisible
 *   100ms   the diamond expands until its gradient fills the screen
 *   450ms   wordmark rises and fades in
 *   570ms   tagline follows
 *   1450ms  the whole overlay cross-fades into the app
 *
 * Every launch after (~640ms): the same expansion, no wordmark, straight into
 * the fade. Still branded, no longer a wait.
 */

// expo-splash-screen renders splash-icon.png at imageWidth 200, and the mark
// occupies 70% of that PNG — so it lands on screen exactly 140px wide. Starting
// here means the diamond never jumps when the native splash is dismissed.
const MARK_BBOX = 140;
const SIDE = MARK_BBOX / Math.SQRT2; // a square rotated 45deg spans side * sqrt2
const RADIUS = SIDE * 0.14; // same ratio as the app icon

const KEY = 'splash.played.v1';

type Plan = {
  expandDelay: number;
  expandMs: number;
  /** Wordmark and tagline are the introduction; returning users skip them. */
  showText: boolean;
  wordDelay: number;
  wordMs: number;
  tagDelay: number;
  tagMs: number;
  hold: number;
  fade: number;
};

const FULL: Plan = {
  expandDelay: 100, expandMs: 650,
  showText: true,
  wordDelay: 450, wordMs: 450,
  tagDelay: 570, tagMs: 450,
  hold: 1450, fade: 300,
};

const QUICK: Plan = {
  expandDelay: 0, expandMs: 380,
  showText: false,
  wordDelay: 0, wordMs: 0,
  tagDelay: 0, tagMs: 0,
  hold: 380, fade: 260,
};

/**
 * Started at import rather than on mount, so the read is already in flight by
 * the time React gets here. Resolving to `false` on failure is the safe way
 * round: the worst case is a returning user seeing the long version again,
 * where the opposite would rob a first-time user of the introduction entirely.
 */
const playedBefore: Promise<boolean> = AsyncStorage.getItem(KEY)
  .then((v) => v === '1')
  .catch(() => false);

/** Never let a stalled read hold the app on a motionless splash. */
const DECIDE_TIMEOUT_MS = 400;

/**
 * The longest the overlay may wait for the app behind it, however slow the
 * session restore turns out to be. Past this the splash leaves regardless and
 * the loading screen — which explains itself — takes over.
 */
const HARD_CAP_MS = 2_600;

export function AnimatedSplash({
  onFinish,
  onFadeStart,
  ready = true,
}: {
  onFinish: () => void;
  /**
   * Fired when the overlay starts dissolving, not when it finishes. The status
   * bar switches to dark ink here: waiting for the end would leave white text
   * sitting on a background that has already turned to cream.
   */
  onFadeStart?: () => void;
  /**
   * Whether the screen underneath is worth revealing yet.
   *
   * The animation length is a floor, not a schedule. Leaving on a fixed timer
   * meant that whenever the session restore ran long the splash uncovered a
   * spinner, and the user watched a considered piece of motion hand over to a
   * loading state — so the shorter the animation got, the more often it
   * happened. Waiting costs nothing when the app is already ready, because
   * then this is false for no time at all.
   */
  ready?: boolean;
}) {
  const { width, height } = useWindowDimensions();
  const [plan, setPlan] = useState<Plan | null>(null);
  const [floorDone, setFloorDone] = useState(false);
  const [capped, setCapped] = useState(false);
  const leaving = useRef(false);

  // The diamond's edges run at 45deg, so it satisfies |x| + |y| <= D/2 and
  // covers a w x h rect once D >= w + h. The margin absorbs the rounded corners.
  const coverScale = ((width + height) / MARK_BBOX) * 1.12;

  const scale = useSharedValue(1);
  const word = useSharedValue(0);
  const tag = useSharedValue(0);
  const overlay = useSharedValue(1);

  useEffect(() => {
    let alive = true;
    const fallback = new Promise<boolean>((resolve) => {
      setTimeout(() => resolve(false), DECIDE_TIMEOUT_MS);
    });

    void Promise.race([playedBefore, fallback]).then((played) => {
      if (alive) setPlan(played ? QUICK : FULL);
    });

    return () => {
      alive = false;
    };
  }, []);

  // The entrance: fixed length, runs the moment the plan is known.
  useEffect(() => {
    if (!plan) return;

    scale.value = withDelay(
      plan.expandDelay,
      withTiming(coverScale, { duration: plan.expandMs, easing: Easing.out(Easing.cubic) }),
    );

    if (plan.showText) {
      word.value = withDelay(
        plan.wordDelay,
        withTiming(1, { duration: plan.wordMs, easing: Easing.out(Easing.quad) }),
      );
      tag.value = withDelay(
        plan.tagDelay,
        withTiming(1, { duration: plan.tagMs, easing: Easing.out(Easing.quad) }),
      );
    }

    const floor = setTimeout(() => setFloorDone(true), plan.hold);
    const cap = setTimeout(() => setCapped(true), HARD_CAP_MS);

    // Written now rather than on completion: someone who kills the app during
    // the animation has still seen it, and replaying it would be the wrong
    // reading of what happened.
    void AsyncStorage.setItem(KEY, '1').catch(() => {
      // Storage unavailable. The introduction plays again next launch, which is
      // a cosmetic cost and not worth surfacing.
    });

    return () => {
      clearTimeout(floor);
      clearTimeout(cap);
    };
  }, [plan, coverScale, scale, word, tag]);

  // The exit: waits for both the floor and the app, and gives up at the cap.
  useEffect(() => {
    if (!plan || leaving.current) return;
    if (!capped && !(floorDone && ready)) return;

    leaving.current = true;
    onFadeStart?.();

    overlay.value = withTiming(
      0,
      { duration: plan.fade, easing: Easing.inOut(Easing.quad) },
      (finished) => {
        if (finished) runOnJS(onFinish)();
      },
    );
  }, [plan, floorDone, ready, capped, overlay, onFinish, onFadeStart]);

  // Every worklet below reads only shared values and literal math. Nothing here
  // may call an imported JS helper — worklets run on the UI thread, where those
  // are undefined. (This is what caused the old "fmtMoney is not a function"
  // crash on Expo Go.)
  const overlayStyle = useAnimatedStyle(() => ({ opacity: overlay.value }));

  const diamondStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: '45deg' }, { scale: scale.value }],
  }));

  const wordStyle = useAnimatedStyle(() => ({
    opacity: word.value,
    transform: [{ translateY: (1 - word.value) * 14 }],
  }));

  const tagStyle = useAnimatedStyle(() => ({
    opacity: tag.value * 0.78,
    transform: [{ translateY: (1 - tag.value) * 10 }],
  }));

  return (
    <Animated.View
      style={[StyleSheet.absoluteFill, styles.root, overlayStyle]}
      testID="animated-splash"
    >
      <View style={[StyleSheet.absoluteFill, styles.center]}>
        {/* The gradient carries the corner radius itself. Rounding the parent
            and clipping with `overflow: hidden` would force Android to render
            this subtree offscreen, and it is being scaled past 10x at the exact
            moment the device is busiest. */}
        <Animated.View style={[styles.diamond, diamondStyle]}>
          <LinearGradient
            colors={theme.color.coralGradient}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={[StyleSheet.absoluteFill, styles.gradient]}
          />
        </Animated.View>
      </View>

      <View style={[StyleSheet.absoluteFill, styles.center]} pointerEvents="none">
        <Animated.Text style={[styles.word, wordStyle]}>SubOrganizer</Animated.Text>
        <Animated.Text style={[styles.tag, tagStyle]}>
          Every subscription. One view.
        </Animated.Text>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: { backgroundColor: theme.color.surface },
  center: { alignItems: 'center', justifyContent: 'center' },
  diamond: {
    width: SIDE,
    height: SIDE,
  },
  gradient: { borderRadius: RADIUS },
  word: {
    color: '#FFFFFF',
    fontSize: 34,
    fontWeight: '800',
    letterSpacing: -1,
  },
  tag: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.4,
    textTransform: 'uppercase',
    marginTop: 12,
  },
});
