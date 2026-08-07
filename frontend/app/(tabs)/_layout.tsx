import React, { useEffect, useRef, useState } from 'react';
import { Redirect, Tabs } from 'expo-router';
import { View, StyleSheet, Pressable, Text, Keyboard } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, {
  Extrapolation, interpolate, useAnimatedStyle, useSharedValue, withSpring,
} from 'react-native-reanimated';
import { theme } from '@/src/theme';
import { useAuth } from '@/src/auth-context';
import { tapFeedback } from '@/src/motion';

/**
 * Three tabs, deliberately.
 *
 * Calendar and Profile moved out to pushed screens rather than being deleted —
 * the calendar is reached from "See all" on Home, the profile from the avatar in
 * its header, which is where people were already tapping for it. Five tabs made
 * the paid feature one of five equals; three make it a third of the app.
 *
 * The bar floats over the content rather than sitting under it, and one pill
 * travels between positions rather than three pills fading in place — the motion
 * is what tells you where you came from.
 */
type TabMeta = {
  active: keyof typeof Ionicons.glyphMap;
  inactive: keyof typeof Ionicons.glyphMap;
  label: string;
};

const ICONS: Record<string, TabMeta> = {
  dashboard: { active: 'home', inactive: 'home-outline', label: 'Home' },
  subscriptions: { active: 'albums', inactive: 'albums-outline', label: 'Subs' },
  insights: { active: 'pricetag', inactive: 'pricetag-outline', label: 'Savings' },
};

/** Height of the travelling pill, and of the icon row it sits behind. */
const PILL_H = 34;
/** Gap between the pill and the edge of its slot. */
const PILL_INSET = 4;

/** Vertical padding inside the floating card, above and below the icon row. */
const CARD_PAD_V = 9;
/** The label under each icon: 10pt type, 3pt above it, rounded up for line height. */
const LABEL_H = 16;
/** Gap between the bottom of the card and the bottom of the screen. */
const WRAP_BOTTOM = 6;

/**
 * How much of the bottom of the screen the floating bar covers.
 *
 * Every tab screen has to keep its last row clear of this, and each one used to
 * carry its own hand-picked number — 108 on Home, 110 on the other two, none of
 * them derived from the bar itself. They happened to be large enough, but only
 * by accident: change the pill height or the label size and all three are wrong
 * with nothing to say so.
 *
 * The inset is folded in here rather than added by the caller, because the bar's
 * own padding is `max(insets.bottom, 10)` — a screen adding a raw `insets.bottom`
 * on top is not measuring the same thing the bar is.
 */
export function useTabBarSpace(): number {
  const insets = useSafeAreaInsets();
  const card = CARD_PAD_V * 2 + PILL_H + LABEL_H;
  return WRAP_BOTTOM + Math.max(insets.bottom, 10) + card;
}

function TabItem({
  routeName, focused, onPress, badgeCount,
}: {
  routeName: string;
  focused: boolean;
  onPress: () => void;
  badgeCount?: number;
}) {
  const meta = ICONS[routeName] ?? {
    active: 'ellipse' as const, inactive: 'ellipse-outline' as const, label: routeName,
  };

  const on = useSharedValue(focused ? 1 : 0);

  useEffect(() => {
    on.value = withSpring(focused ? 1 : 0, theme.motion.enter);
  }, [focused, on]);

  // A small lift on selection. Enough to read as "this one", not enough to
  // shift the row's baseline.
  const lift = useAnimatedStyle(() => ({
    transform: [{ translateY: interpolate(on.value, [0, 1], [0, -1], Extrapolation.CLAMP) }],
  }));

  /*
   * Two icons cross-fading, rather than one icon changing colour.
   *
   * The pill now travels, so for the length of that journey the selected icon
   * is somewhere other than on top of the pill. Switching the colour on
   * `focused` would put a white icon on white card for those 200ms and a dark
   * icon on the near-black pill — both invisible. Fading between the two on the
   * same spring as the pill means the colour arrives exactly when the pill does.
   */
  const outgoing = useAnimatedStyle(() => ({ opacity: 1 - on.value }));
  const incoming = useAnimatedStyle(() => ({ opacity: on.value }));

  const count = badgeCount ?? 0;
  const label = count > 0
    ? `${meta.label}, ${count} ${count === 1 ? 'renewal' : 'renewals'} due`
    : meta.label;

  return (
    <Pressable
      onPress={() => {
        if (!focused) tapFeedback('selection');
        onPress();
      }}
      testID={`tab-${routeName}`}
      style={s.item}
      hitSlop={8}
      accessibilityRole="tab"
      accessibilityState={{ selected: focused }}
      accessibilityLabel={label}
    >
      <View style={s.itemInner}>
        <Animated.View style={[s.iconRow, lift]}>
          <Animated.View style={outgoing}>
            <Ionicons name={meta.inactive} size={20} color={theme.color.inkSoft} />
          </Animated.View>
          <Animated.View style={[StyleSheet.absoluteFill, s.iconOverlay, incoming]}>
            <Ionicons name={meta.active} size={20} color="#FFFFFF" />
          </Animated.View>

          {count > 0 && (
            <View style={s.badge} testID={`tab-badge-${routeName}`}>
              <Text style={s.badgeText}>{count > 9 ? '9+' : count}</Text>
            </View>
          )}
        </Animated.View>
        <Text style={[s.label, focused && s.labelActive]} numberOfLines={1}>
          {meta.label}
        </Text>
      </View>
    </Pressable>
  );
}

type TabBarProps = {
  state: { index: number; routes: { key: string; name: string }[] };
  navigation: {
    emit: (e: { type: 'tabPress'; target: string; canPreventDefault: boolean }) => { defaultPrevented: boolean };
    navigate: (name: string) => void;
  };
};

function TabBar({ state, navigation }: TabBarProps) {
  const insets = useSafeAreaInsets();
  const { reminders } = useAuth();

  const [rowWidth, setRowWidth] = useState(0);
  const [keyboardUp, setKeyboardUp] = useState(false);

  const slot = rowWidth > 0 ? rowWidth / state.routes.length : 0;
  const x = useSharedValue(0);
  const placed = useRef(false);

  useEffect(() => {
    if (slot === 0) return;
    const target = state.index * slot;

    // The first placement is a fact, not a transition — springing in from zero
    // would animate the pill across the bar every time the app opens.
    if (!placed.current) {
      placed.current = true;
      x.value = target;
      return;
    }
    x.value = withSpring(target, theme.motion.enter);
  }, [state.index, slot, x]);

  /*
   * The bar is absolutely positioned, so a resized window puts it directly on
   * top of the keyboard — covering the list it is floating over at the exact
   * moment the search field has already taken half the screen.
   */
  useEffect(() => {
    const show = Keyboard.addListener('keyboardDidShow', () => setKeyboardUp(true));
    const hide = Keyboard.addListener('keyboardDidHide', () => setKeyboardUp(false));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  const pill = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }] }));

  if (keyboardUp) return null;

  return (
    <View style={[s.wrap, { paddingBottom: Math.max(insets.bottom, 10) }]} testID="tab-bar">
      <View style={s.card}>
        <View
          style={s.row}
          onLayout={(e) => setRowWidth(e.nativeEvent.layout.width)}
        >
          {slot > 0 && (
            <Animated.View
              style={[s.pill, { width: slot - PILL_INSET * 2, left: PILL_INSET }, pill]}
              pointerEvents="none"
            />
          )}

          {state.routes.map((route, idx) => {
            const focused = state.index === idx;
            return (
              <TabItem
                key={route.key}
                routeName={route.name}
                focused={focused}
                onPress={() => {
                  const event = navigation.emit({
                    type: 'tabPress', target: route.key, canPreventDefault: true,
                  });
                  if (!focused && !event.defaultPrevented) navigation.navigate(route.name);
                }}
                badgeCount={route.name === 'dashboard' ? reminders?.length ?? 0 : 0}
              />
            );
          })}
        </View>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { position: 'absolute', left: 16, right: 16, bottom: 6 },
  card: {
    backgroundColor: theme.color.raised,
    borderRadius: theme.radius.xl,
    paddingVertical: 9,
    paddingHorizontal: 6,
    ...theme.shadow.lg,
  },
  row: { flexDirection: 'row' },
  item: { flex: 1, alignItems: 'center' },
  itemInner: { alignItems: 'center', paddingHorizontal: 8, minWidth: 56 },
  pill: {
    position: 'absolute', top: 0, height: PILL_H,
    borderRadius: theme.radius.pill,
    backgroundColor: theme.color.inverse,
  },
  iconRow: { height: PILL_H, alignItems: 'center', justifyContent: 'center' },
  iconOverlay: { alignItems: 'center', justifyContent: 'center' },
  label: {
    fontSize: 10, fontWeight: '700', color: theme.color.inkSoft,
    letterSpacing: 0.2, marginTop: 3,
  },
  labelActive: { color: theme.color.ink, fontWeight: '800' },
  badge: {
    position: 'absolute', top: 0, right: -11,
    minWidth: 16, height: 16, paddingHorizontal: 4,
    borderRadius: 8, backgroundColor: theme.color.brandPrimary,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 2, borderColor: theme.color.raised,
  },
  badgeText: { color: '#FFFFFF', fontSize: 9, fontWeight: '800' },
});

export default function TabsLayout() {
  const { user, loading } = useAuth();
  if (loading) return null;
  if (!user) return <Redirect href="/auth" />;
  return (
    <Tabs
      screenOptions={{ headerShown: false }}
      tabBar={(props) => <TabBar {...(props as unknown as TabBarProps)} />}
    >
      <Tabs.Screen name="dashboard" />
      <Tabs.Screen name="subscriptions" />
      <Tabs.Screen name="insights" />
    </Tabs>
  );
}
