import React, { useEffect } from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
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
 * Launch animation that plays once, directly after the native splash.
 *
 * Timeline (~1.75s total):
 *   0ms     cream field, coral diamond at rest — pixel-matched to the native
 *           splash so the handoff between the two is invisible
 *   100ms   the diamond expands until its gradient fills the screen
 *   450ms   wordmark rises and fades in
 *   570ms   tagline follows
 *   1450ms  the whole overlay cross-fades into the app
 */

// expo-splash-screen renders splash-icon.png at imageWidth 200, and the mark
// occupies 70% of that PNG — so it lands on screen exactly 140px wide. Starting
// here means the diamond never jumps when the native splash is dismissed.
const MARK_BBOX = 140;
const SIDE = MARK_BBOX / Math.SQRT2; // a square rotated 45deg spans side * sqrt2
const RADIUS = SIDE * 0.14; // same ratio as the app icon

const EXPAND_DELAY = 100;
const EXPAND_MS = 650;
const WORD_DELAY = 450;
const WORD_MS = 450;
const TAG_DELAY = 570;
const TAG_MS = 450;
const HOLD_UNTIL = 1450;
const FADE_MS = 300;

export function AnimatedSplash({ onFinish }: { onFinish: () => void }) {
  const { width, height } = useWindowDimensions();

  // The diamond's edges run at 45deg, so it satisfies |x| + |y| <= D/2 and
  // covers a w x h rect once D >= w + h. The margin absorbs the rounded corners.
  const coverScale = ((width + height) / MARK_BBOX) * 1.12;

  const scale = useSharedValue(1);
  const word = useSharedValue(0);
  const tag = useSharedValue(0);
  const overlay = useSharedValue(1);

  useEffect(() => {
    scale.value = withDelay(
      EXPAND_DELAY,
      withTiming(coverScale, { duration: EXPAND_MS, easing: Easing.out(Easing.cubic) }),
    );
    word.value = withDelay(
      WORD_DELAY,
      withTiming(1, { duration: WORD_MS, easing: Easing.out(Easing.quad) }),
    );
    tag.value = withDelay(
      TAG_DELAY,
      withTiming(1, { duration: TAG_MS, easing: Easing.out(Easing.quad) }),
    );
    overlay.value = withDelay(
      HOLD_UNTIL,
      withTiming(
        0,
        { duration: FADE_MS, easing: Easing.inOut(Easing.quad) },
        (finished) => {
          if (finished) runOnJS(onFinish)();
        },
      ),
    );
  }, [coverScale, scale, word, tag, overlay, onFinish]);

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
        <Animated.View style={[styles.diamond, diamondStyle]}>
          <LinearGradient
            colors={theme.color.coralGradient}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={StyleSheet.absoluteFill}
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
    borderRadius: RADIUS,
    overflow: 'hidden',
  },
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
