import React from 'react';
import { Tabs } from 'expo-router';
import { View, StyleSheet, Pressable, Text } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { useSharedValue, useAnimatedStyle, withSpring, withTiming } from 'react-native-reanimated';
import { theme } from '@/src/theme';
import { useAuth } from '@/src/auth-context';
import { Redirect } from 'expo-router';

const ICONS: Record<string, { active: any; inactive: any; label: string }> = {
  dashboard: { active: 'home', inactive: 'home-outline', label: 'Home' },
  subscriptions: { active: 'albums', inactive: 'albums-outline', label: 'Subs' },
  calendar: { active: 'calendar', inactive: 'calendar-outline', label: 'Calendar' },
  insights: { active: 'sparkles', inactive: 'sparkles-outline', label: 'AI' },
  profile: { active: 'person', inactive: 'person-outline', label: 'You' },
};

function TabItem({
  routeName, focused, onPress, badgeCount,
}: {
  routeName: string; focused: boolean; onPress: () => void; badgeCount?: number;
}) {
  const meta = ICONS[routeName] || { active: 'ellipse', inactive: 'ellipse-outline', label: routeName };
  const scale = useSharedValue(focused ? 1 : 0);
  React.useEffect(() => {
    scale.value = withSpring(focused ? 1 : 0, { damping: 18, stiffness: 220 });
  }, [focused, scale]);

  const bgStyle = useAnimatedStyle(() => ({
    opacity: scale.value,
    transform: [{ scale: 0.7 + scale.value * 0.3 }],
  }));

  return (
    <Pressable onPress={onPress} testID={`tab-${routeName}`} style={styles.item} hitSlop={8}>
      <View style={styles.itemInner}>
        <Animated.View style={[styles.activePill, bgStyle]} pointerEvents="none" />
        <View style={styles.iconRow}>
          <Ionicons
            name={focused ? meta.active : meta.inactive}
            size={20}
            color={focused ? '#FFFFFF' : theme.color.inkSoft}
          />
          {badgeCount && badgeCount > 0 ? (
            <View style={styles.badge} testID={`tab-badge-${routeName}`}>
              <Text style={styles.badgeText}>{badgeCount > 9 ? '9+' : badgeCount}</Text>
            </View>
          ) : null}
        </View>
        <Text style={[styles.label, focused && styles.labelActive]} numberOfLines={1}>
          {meta.label}
        </Text>
      </View>
    </Pressable>
  );
}

function TabBar({ state, navigation }: any) {
  const insets = useSafeAreaInsets();
  const { reminders } = useAuth();
  const reminderCount = reminders?.length ?? 0;

  return (
    <View style={[styles.wrap, { paddingBottom: Math.max(insets.bottom, 10) }]} testID="tab-bar">
      <View style={styles.card}>
        <View style={styles.row}>
          {state.routes.map((route: any, idx: number) => {
            const focused = state.index === idx;
            const onPress = () => {
              const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
              if (!focused && !event.defaultPrevented) navigation.navigate(route.name);
            };
            return (
              <TabItem
                key={route.key}
                routeName={route.name}
                focused={focused}
                onPress={onPress}
                badgeCount={route.name === 'dashboard' ? reminderCount : 0}
              />
            );
          })}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute', left: 14, right: 14, bottom: 8,
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 24,
    borderWidth: 1,
    borderColor: theme.color.border,
    paddingVertical: 10,
    paddingHorizontal: 6,
    shadowColor: '#1A1C1E',
    shadowOpacity: 0.1,
    shadowRadius: 22,
    shadowOffset: { width: 0, height: 14 },
    elevation: 12,
  },
  row: { flexDirection: 'row', alignItems: 'stretch' },
  item: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  itemInner: { alignItems: 'center', paddingVertical: 6, paddingHorizontal: 8, minWidth: 56, position: 'relative' },
  activePill: {
    position: 'absolute', top: 0, left: 6, right: 6, height: 34,
    borderRadius: 999,
    backgroundColor: theme.color.ink,
  },
  iconRow: { height: 34, alignItems: 'center', justifyContent: 'center' },
  label: {
    fontSize: 10, fontWeight: '600', color: theme.color.inkSoft, letterSpacing: 0.3, marginTop: 4,
  },
  labelActive: { color: theme.color.ink, fontWeight: '700' },
  badge: {
    position: 'absolute', top: -2, right: -12, minWidth: 16, height: 16, paddingHorizontal: 4,
    borderRadius: 8, backgroundColor: theme.color.brandPrimary,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 2, borderColor: '#FFFFFF',
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
      tabBar={(props) => <TabBar {...props} />}
    >
      <Tabs.Screen name="dashboard" />
      <Tabs.Screen name="subscriptions" />
      <Tabs.Screen name="calendar" />
      <Tabs.Screen name="insights" />
      <Tabs.Screen name="profile" />
    </Tabs>
  );
}
