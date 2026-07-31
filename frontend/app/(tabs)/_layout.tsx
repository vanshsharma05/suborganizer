import React, { useEffect } from 'react';
import { Redirect, Tabs } from 'expo-router';
import { View, StyleSheet, Pressable, Text } from 'react-native';
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
 * The bar floats over the content rather than sitting under it, and the selected
 * item's pill slides between positions rather than fading in place — the motion
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

  const pill = useAnimatedStyle(() => ({
    opacity: on.value,
    transform: [{ scale: interpolate(on.value, [0, 1], [0.75, 1], Extrapolation.CLAMP) }],
  }));

  // A small lift on selection. Enough to read as "this one", not enough to
  // shift the row's baseline.
  const icon = useAnimatedStyle(() => ({
    transform: [{ translateY: interpolate(on.value, [0, 1], [0, -1], Extrapolation.CLAMP) }],
  }));

  return (
    <Pressable
      onPress={() => {
        if (!focused) tapFeedback('selection');
        onPress();
      }}
      testID={`tab-${routeName}`}
      style={s.item}
      hitSlop={8}
    >
      <View style={s.itemInner}>
        <Animated.View style={[s.pill, pill]} pointerEvents="none" />
        <Animated.View style={[s.iconRow, icon]}>
          <Ionicons
            name={focused ? meta.active : meta.inactive}
            size={20}
            color={focused ? '#FFFFFF' : theme.color.inkSoft}
          />
          {badgeCount !== undefined && badgeCount > 0 && (
            <View style={s.badge} testID={`tab-badge-${routeName}`}>
              <Text style={s.badgeText}>{badgeCount > 9 ? '9+' : badgeCount}</Text>
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

  return (
    <View style={[s.wrap, { paddingBottom: Math.max(insets.bottom, 10) }]} testID="tab-bar">
      <View style={s.card}>
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
  );
}

const s = StyleSheet.create({
  wrap: { position: 'absolute', left: 16, right: 16, bottom: 6 },
  card: {
    flexDirection: 'row',
    backgroundColor: theme.color.raised,
    borderRadius: theme.radius.xl,
    paddingVertical: 9,
    paddingHorizontal: 6,
    ...theme.shadow.lg,
  },
  item: { flex: 1, alignItems: 'center' },
  itemInner: { alignItems: 'center', paddingHorizontal: 8, minWidth: 56 },
  pill: {
    position: 'absolute', top: 0, left: 4, right: 4, height: 34,
    borderRadius: theme.radius.pill,
    backgroundColor: theme.color.inverse,
  },
  iconRow: { height: 34, alignItems: 'center', justifyContent: 'center' },
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
    <Tabs screenOptions={{ headerShown: false }} tabBar={(props) => <TabBar {...(props as unknown as TabBarProps)} />}>
      <Tabs.Screen name="dashboard" />
      <Tabs.Screen name="subscriptions" />
      <Tabs.Screen name="insights" />
    </Tabs>
  );
}
