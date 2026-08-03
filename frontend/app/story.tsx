import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, Pressable, ScrollView, ActivityIndicator, useWindowDimensions,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import Animated, {
  Easing,
  Extrapolation,
  interpolate,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import { theme, CATEGORY_COLORS } from '@/src/theme';
import { useAuth } from '@/src/auth-context';
import { BrandAvatar } from '@/src/ui';
import { convertToPrimary, fmtMoney, symbolFor, useExchangeRate } from '@/src/currency';
import { monthlyEquivalent } from '@/src/cycles';
import { runAudit } from '@/src/savings';
import { lockedCount, lockedValue, PRODUCTS, revealAudit } from '@/src/entitlements';
import { usePurchases } from '@/src/purchases';
import { UpgradeSheet } from '@/src/paywall';
import { buildStory, type Slide } from '@/src/story';
import { markStoryPlayed } from '@/src/story-storage';
import {
  CategoryBars,
  DriftingBlobs,
  MonthGrid,
  Parallax,
  ShareRing,
} from '@/src/story-visuals';
import { CountUp, groupDigits, Press, Pulse } from '@/src/motion';
import { fitText } from '@/src/fit-text';

const AnimatedScrollView = Animated.createAnimatedComponent(ScrollView);

/** Horizontal padding either side of a slide; see `s.page`. */
const PAGE_PAD = 30;

/**
 * A figure that counts up when its slide arrives, then settles.
 *
 * The ramp is quartic-out: quick enough that it never feels like waiting, slow
 * enough at the tail that the final digits are readable as they land. It runs on
 * visibility rather than mount, because every slide is mounted at once and a
 * number that finished counting three screens away has spent the only moment it
 * had.
 */
function RollingAmount({
  value, currency, active, size = 68,
}: {
  value: number; currency: string; active: boolean; size?: number;
}) {
  const { width } = useWindowDimensions();
  const enter = useSharedValue(0);

  const fontSize = fitText(
    `${symbolFor(currency)}${groupDigits(value, currency === 'INR')}`,
    width - PAGE_PAD * 2,
    size,
  );

  useEffect(() => {
    enter.value = active
      ? withTiming(1, { duration: 420, easing: Easing.out(Easing.back(1.6)) })
      : 0;
  }, [active, enter]);

  const style = useAnimatedStyle(() => ({
    transform: [{ scale: interpolate(enter.value, [0, 1], [0.72, 1], Extrapolation.CLAMP) }],
    opacity: enter.value,
  }));

  return (
    <Animated.View style={style}>
      {/* Counts on the UI thread. The version of this that ran on
          requestAnimationFrame + setState re-rendered the whole slide sixty
          times a second, which is exactly when the pager needs the JS thread. */}
      <CountUp
        value={value}
        symbol={symbolFor(currency)}
        indian={currency === 'INR'}
        active={active}
        duration={1500}
        style={[s.bigAmount, { fontSize, height: fontSize * 1.2 }]}
        testID="story-amount"
      />
    </Animated.View>
  );
}

/** Fades and lifts in on a delay, once its slide is visible. */
function Rise({
  active, delay = 0, children, style,
}: {
  active: boolean; delay?: number; children: React.ReactNode; style?: object;
}) {
  const v = useSharedValue(0);

  useEffect(() => {
    v.value = active
      ? withDelay(delay, withTiming(1, { duration: 620, easing: Easing.out(Easing.cubic) }))
      : 0;
  }, [active, delay, v]);

  const animated = useAnimatedStyle(() => ({
    opacity: v.value,
    transform: [{ translateY: (1 - v.value) * 22 }],
  }));

  return <Animated.View style={[style, animated]}>{children}</Animated.View>;
}

export default function StoryScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { width } = useWindowDimensions();
  const { user, subs, subsLoading, priceChanges } = useAuth();
  const { unlocked } = usePurchases();
  const scroller = useRef<ScrollView>(null);
  const [index, setIndex] = useState(0);
  const [upgrading, setUpgrading] = useState(false);

  const primary = (user?.primary_currency || 'INR').toUpperCase();
  const rate = useExchangeRate();
  const scrollX = useSharedValue(0);

  const convert = useMemo(
    () => (amount: number, from: string | undefined, to: string) =>
      convertToPrimary(amount, from, to, rate),
    [rate],
  );

  const audit = useMemo(
    () => runAudit(subs, priceChanges, { primaryCurrency: primary, convert }),
    [subs, priceChanges, primary, convert],
  );

  const slides = useMemo(
    () => buildStory({ subs, audit, primaryCurrency: primary, convert, name: user?.name }),
    [subs, audit, primary, convert, user?.name],
  );

  // The story always shows the full total, paid or not. Holding back the number
  // would remove the only thing that makes the ask land — you cannot want the
  // detail behind a figure you were never shown.
  const reveals = useMemo(() => revealAudit(audit.savings, unlocked), [audit.savings, unlocked]);
  const behindWall = lockedValue(reveals);
  const stillLocked = lockedCount(reveals);

  /** Spend per category, biggest first — the infographic on the monthly slide. */
  const categories = useMemo(() => {
    const totals: Record<string, number> = {};
    for (const sub of subs) {
      if (sub.status !== 'active') continue;
      const v = convert(monthlyEquivalent(sub.amount, sub.billing_cycle), sub.currency, primary);
      totals[sub.category] = (totals[sub.category] ?? 0) + v;
    }
    return Object.entries(totals)
      .map(([key, value]) => ({ key, value, color: CATEGORY_COLORS[key] ?? '#FFFFFF' }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 5);
  }, [subs, primary, convert]);

  const monthlyTotal = categories.reduce((sum, c) => sum + c.value, 0);

  // Written once the story is actually showing, not while it is still waiting on
  // data — marking it played during the hold would burn the week's replay on a
  // screen that never rendered a slide.
  useEffect(() => {
    if (!subsLoading) void markStoryPlayed();
  }, [subsLoading]);

  const onScroll = useAnimatedScrollHandler({
    onScroll: (e) => {
      scrollX.value = e.contentOffset.x;
    },
  });

  const finish = () => router.replace('/(tabs)/dashboard');

  /**
   * Moves on, and updates the index itself rather than trusting the scroll to
   * report back.
   *
   * `onMomentumScrollEnd` is the only other thing that sets `index`, and Android
   * does not reliably fire it for a programmatic `scrollTo`. When it did not
   * fire, `index` stayed put — so the next tap computed the same target, the
   * pager did not move, and the button was dead with no way forward but a swipe.
   */
  const advance = () => {
    const next = index + 1;
    if (next > slides.length - 1) return finish();
    setIndex(next);
    scroller.current?.scrollTo({ x: next * width, animated: true });
  };

  /**
   * Hold everything until the subscription list has settled.
   *
   * The list arrives in the background, so on first render it is empty for
   * everyone — which buildStory correctly reads as "nothing tracked" and turns
   * into the single scan slide. For someone who has twelve subscriptions that
   * meant a flash of "let us find what you pay for" before their real story
   * replaced it: the app telling a returning user it has never met them.
   *
   * A blank gradient for a moment is honest. A wrong story is not.
   */
  if (subsLoading) {
    return (
      <View style={s.root}>
        <LinearGradient
          colors={theme.color.coralGradient}
          start={{ x: 0.1, y: 0 }}
          end={{ x: 0.9, y: 1 }}
          style={StyleSheet.absoluteFill}
        />
        <DriftingBlobs scrollX={scrollX} />
        <View style={s.holding}>
          <ActivityIndicator color="#FFFFFF" />
          <Text style={s.holdingText}>Working out your year…</Text>
        </View>
      </View>
    );
  }

  const last = index === slides.length - 1;
  const showScanCta = slides[index]?.kind === 'scan';
  // The one moment the ask is not an interruption: they have just watched a
  // number they did not know go up, and the button is the answer to it.
  const showUpgradeCta = slides[index]?.kind === 'savings' && stillLocked > 0;

  return (
    <View style={s.root}>
      <LinearGradient
        colors={theme.color.coralGradient}
        start={{ x: 0.1, y: 0 }}
        end={{ x: 0.9, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
      <DriftingBlobs scrollX={scrollX} />

      <View style={[s.progress, { paddingTop: insets.top + 14 }]}>
        {slides.map((slide, i) => (
          <Tick key={slide.id} index={i} scrollX={scrollX} width={width} />
        ))}
      </View>

      {/* The escape hatch, so it gets a full-size target rather than the 30px
          one the text alone gave it. */}
      <Pressable
        onPress={finish}
        style={[s.skip, { top: insets.top + 26 }]}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel="Skip the rundown"
        testID="story-skip"
      >
        <Text style={s.skipText}>Skip</Text>
      </Pressable>

      <AnimatedScrollView
        ref={scroller as never}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onScroll={onScroll}
        scrollEventThrottle={16}
        onMomentumScrollEnd={(e) => setIndex(Math.round(e.nativeEvent.contentOffset.x / width))}
        testID="story-pager"
      >
        {slides.map((slide, i) => (
          <View key={slide.id} style={[s.page, { width }]}>
            <SlideBody
              slide={slide}
              index={i}
              active={i === index}
              scrollX={scrollX}
              currency={primary}
              categories={categories}
              monthlyTotal={monthlyTotal}
              convert={convert}
              locked={stillLocked}
            />
          </View>
        ))}
      </AnimatedScrollView>

      {/* Press rather than Pressable: these were the only primary buttons in the
          app with no scale response and no haptic, which made the story's own
          controls feel less answerable than every other screen's. */}
      <View style={[s.footer, { paddingBottom: insets.bottom + 20 }]}>
        {showScanCta ? (
          <Press onPress={() => router.replace('/scan')} haptic="medium" testID="story-scan">
            <View style={s.cta}>
              <Ionicons name="logo-google" size={17} color={theme.color.brandDeep} />
              <Text style={s.ctaText}>Scan my Gmail</Text>
            </View>
          </Press>
        ) : showUpgradeCta ? (
          <>
            <Press onPress={() => setUpgrading(true)} haptic="medium" testID="story-unlock">
              <View style={s.cta}>
                <Ionicons name="lock-open" size={17} color={theme.color.brandDeep} />
                <Text style={s.ctaText}>Show me all {stillLocked}</Text>
              </View>
            </Press>
            <Press onPress={advance} testID="story-next">
              <View style={s.secondary}>
                <Text style={s.secondaryText}>{last ? 'Maybe later' : 'Next'}</Text>
              </View>
            </Press>
          </>
        ) : (
          <Press onPress={advance} haptic="medium" testID="story-next">
            <View style={s.cta}>
              <Text style={s.ctaText}>{last ? 'See my dashboard' : 'Next'}</Text>
              <Ionicons
                name={last ? 'arrow-forward' : 'chevron-forward'}
                size={17}
                color={theme.color.brandDeep}
              />
            </View>
          </Press>
        )}
      </View>

      <UpgradeSheet
        product={PRODUCTS.pro}
        visible={upgrading}
        onClose={() => setUpgrading(false)}
        worth={behindWall}
        currency={primary}
        // Straight to the findings they just paid for. Dropping someone back on
        // the slide they bought from is the moment a purchase feels like nothing
        // happened.
        onPurchased={() => router.replace('/(tabs)/insights')}
      />
    </View>
  );
}

/** A progress segment that fills continuously with the swipe. */
function Tick({
  index, scrollX, width,
}: {
  index: number; scrollX: SharedValue<number>; width: number;
}) {
  const style = useAnimatedStyle(() => ({
    width: `${interpolate(
      scrollX.value,
      [(index - 1) * width, index * width],
      [0, 100],
      Extrapolation.CLAMP,
    )}%`,
  }));

  return (
    <View style={s.tick}>
      <Animated.View style={[s.tickFill, style]} />
    </View>
  );
}

function SlideBody({
  slide, index, active, scrollX, currency, categories, monthlyTotal, convert, locked,
}: {
  slide: Slide;
  index: number;
  active: boolean;
  scrollX: SharedValue<number>;
  currency: string;
  categories: { key: string; value: number; color: string }[];
  monthlyTotal: number;
  convert: (amount: number, from: string | undefined, to: string) => number;
  /** Findings this user cannot read yet. Zero for Pro. */
  locked: number;
}) {
  switch (slide.kind) {
    case 'intro':
      return (
        <Parallax scrollX={scrollX} index={index} depth={0.2}>
          <Rise active={active}>
            <Text style={s.bigTitle}>{slide.title}</Text>
          </Rise>
          <Rise active={active} delay={280}>
            <Text style={s.caption}>{slide.caption}</Text>
          </Rise>
        </Parallax>
      );

    case 'amount': {
      // Only the headline monthly figure earns the category breakdown; repeating
      // it on the annual slide would say the same thing twice.
      const showBars = slide.id === 'monthly' && categories.length > 1;
      const showGrid = slide.id === 'yearly';
      const urgent = slide.id === 'trials';

      const amount = (
        <>
          <Text style={s.label}>{slide.label}</Text>
          <RollingAmount value={slide.value} currency={slide.currency} active={active} />
        </>
      );

      return (
        <Parallax scrollX={scrollX} index={index} depth={0.28}>
          <Rise active={active}>{urgent ? <Pulse active={active}>{amount}</Pulse> : amount}</Rise>

          {showBars && (
            <CategoryBars
              data={categories}
              active={active}
              currency={currency}
              format={(n, c) => fmtMoney(n, c)}
            />
          )}
          {showGrid && <MonthGrid active={active} />}

          <Rise active={active} delay={showGrid ? 900 : 620}>
            <Text style={s.caption}>{slide.caption}</Text>
          </Rise>
        </Parallax>
      );
    }

    case 'spotlight': {
      const monthly = convert(
        monthlyEquivalent(slide.sub.amount, slide.sub.billing_cycle),
        slide.sub.currency,
        currency,
      );
      const share = monthlyTotal > 0 ? Math.min(1, monthly / monthlyTotal) : 0;

      return (
        <Parallax scrollX={scrollX} index={index} depth={0.3}>
          <Rise active={active}>
            <Text style={s.label}>{slide.label}</Text>
          </Rise>

          <View style={s.spotRow}>
            <ShareRing
              fraction={share}
              active={active}
              label={`${Math.round(share * 100)}%`}
            />
            <Rise active={active} delay={340} style={{ flex: 1 }}>
              <BrandAvatar sub={slide.sub} size={44} />
              <Text style={s.spotName} numberOfLines={2}>{slide.sub.name}</Text>
              <Text style={s.spotAmount}>
                {fmtMoney(monthly, currency)}
                <Text style={s.spotPer}> / mo</Text>
              </Text>
            </Rise>
          </View>

          <Rise active={active} delay={700}>
            <Text style={s.caption}>
              That is {Math.round(share * 100)}% of everything you spend. {slide.caption}
            </Text>
          </Rise>
        </Parallax>
      );
    }

    case 'savings':
      return (
        <Parallax scrollX={scrollX} index={index} depth={0.32}>
          <Rise active={active}>
            <View style={s.foundChip}>
              <Ionicons name="sparkles" size={13} color="#FFFFFF" />
              <Text style={s.foundChipText}>Savings audit</Text>
            </View>
            <Text style={s.label}>We found money you can take back</Text>
          </Rise>

          <Pulse active={active}>
            <RollingAmount value={slide.total} currency={slide.currency} active={active} size={72} />
          </Pulse>

          <Rise active={active} delay={700}>
            <Text style={s.caption}>
              a year, across {slide.count} {slide.count === 1 ? 'thing' : 'things'} worth acting on
              {slide.certain > 0 ? ` — ${slide.certain} confirmed outright` : ''}.
            </Text>
          </Rise>

          {/* Said plainly rather than discovered later. Someone who taps through
              expecting all of it and finds one is a refund; someone told there
              is one free and the rest behind ₹199 is a decision. */}
          {locked > 0 && (
            <Rise active={active} delay={920}>
              <View style={s.freeNote}>
                <Ionicons name="lock-open-outline" size={13} color="#FFFFFF" />
                <Text style={s.freeNoteText}>
                  {locked === 1
                    ? 'One is yours free. The other one is in Pro.'
                    : `One is yours free. The other ${locked} are in Pro.`}
                </Text>
              </View>
            </Rise>
          )}
        </Parallax>
      );

    case 'scan':
      return (
        <Parallax scrollX={scrollX} index={index} depth={0.25}>
          <Rise active={active}>
            <Pulse active={active}>
              <View style={s.scanIcon}>
                <Ionicons name="mail-open-outline" size={38} color="#FFFFFF" />
              </View>
            </Pulse>
          </Rise>
          <Rise active={active} delay={220}>
            <Text style={s.bigTitle}>{slide.title}</Text>
          </Rise>
          <Rise active={active} delay={440}>
            <Text style={s.caption}>{slide.caption}</Text>
          </Rise>
        </Parallax>
      );
  }
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.color.brandPrimary },
  holding: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 14 },
  holdingText: { color: 'rgba(255,255,255,0.9)', fontSize: 14, fontWeight: '700' },

  progress: { flexDirection: 'row', gap: 5, paddingHorizontal: 22, zIndex: 5 },
  tick: {
    flex: 1, height: 3, borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.28)', overflow: 'hidden',
  },
  tickFill: { height: '100%', backgroundColor: '#FFFFFF', borderRadius: 2 },

  skip: {
    position: 'absolute', right: 12, zIndex: 10,
    minWidth: 60, height: 44, paddingHorizontal: 12,
    alignItems: 'center', justifyContent: 'center',
  },
  skipText: { color: 'rgba(255,255,255,0.85)', fontSize: 13, fontWeight: '700' },

  page: { flex: 1, justifyContent: 'center', paddingHorizontal: 30 },

  label: {
    color: 'rgba(255,255,255,0.9)', fontSize: 15.5, fontWeight: '700',
    letterSpacing: 0.1, marginBottom: 10, maxWidth: 300,
  },
  bigTitle: {
    color: '#FFFFFF', fontSize: 40, fontWeight: '800',
    letterSpacing: -1.4, lineHeight: 46,
  },
  bigAmount: { color: '#FFFFFF', fontWeight: '800', letterSpacing: -3 },
  caption: {
    color: 'rgba(255,255,255,0.82)', fontSize: 15, lineHeight: 22,
    marginTop: 18, maxWidth: 320,
  },

  spotRow: { flexDirection: 'row', alignItems: 'center', gap: 20, marginTop: 16 },
  spotName: { color: '#FFFFFF', fontSize: 24, fontWeight: '800', letterSpacing: -0.6, marginTop: 10 },
  spotAmount: { color: '#FFFFFF', fontSize: 20, fontWeight: '800', letterSpacing: -0.5, marginTop: 4 },
  spotPer: { color: 'rgba(255,255,255,0.72)', fontSize: 14, fontWeight: '600' },

  foundChip: {
    alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: 'rgba(0,0,0,0.2)', paddingHorizontal: 11, paddingVertical: 6,
    borderRadius: theme.radius.pill, marginBottom: 14,
  },
  foundChipText: {
    color: '#FFFFFF', fontSize: 10.5, fontWeight: '800',
    letterSpacing: 0.8, textTransform: 'uppercase',
  },

  freeNote: {
    alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 7,
    backgroundColor: 'rgba(0,0,0,0.2)', paddingHorizontal: 12, paddingVertical: 8,
    borderRadius: theme.radius.pill, marginTop: 16, maxWidth: 320,
  },
  freeNoteText: { color: '#FFFFFF', fontSize: 12, fontWeight: '700', flexShrink: 1 },

  scanIcon: {
    width: 76, height: 76, borderRadius: 26,
    backgroundColor: 'rgba(255,255,255,0.18)',
    alignItems: 'center', justifyContent: 'center', marginBottom: 22,
  },

  footer: { paddingHorizontal: 28, paddingTop: 12 },
  cta: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    height: 56, borderRadius: theme.radius.pill, backgroundColor: '#FFFFFF',
  },
  ctaText: { color: theme.color.brandDeep, fontSize: 15.5, fontWeight: '800' },
  secondary: { alignItems: 'center', paddingTop: 14, paddingBottom: 2 },
  secondaryText: { color: 'rgba(255,255,255,0.85)', fontSize: 13.5, fontWeight: '700' },
});
