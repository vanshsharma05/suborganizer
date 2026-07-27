import React from 'react';
import { Tabs } from 'expo-router';
import { View, StyleSheet, Pressable, Text } from 'react-native';
import { BlurView } from 'expo-blur';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { theme } from '@/src/theme';
import { useAuth } from '@/src/auth-context';
import { Redirect } from 'expo-router';

const ICONS: Record<string, { active: any; inactive: any; label: string }> = {
  dashboard: { active: 'home', inactive: 'home-outline', label: 'Home' },
  subscriptions: { active: 'albums', inactive: 'albums-outline', label: 'Subs' },
  calendar: { active: 'calendar', inactive: 'calendar-outline', label: 'Calendar' },
  insights: { active: 'sparkles', inactive: 'sparkles-outline', label: 'Insights' },
  profile: { active: 'person', inactive: 'person-outline', label: 'Profile' },
};

function TabBar({ state, descriptors, navigation }: any) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[tbStyles.wrap, { paddingBottom: Math.max(insets.bottom, 12) }]} testID="tab-bar">
      <BlurView intensity={40} tint="light" style={tbStyles.blur}>
        <View style={tbStyles.row}>
          {state.routes.map((route: any, idx: number) => {
            const meta = ICONS[route.name] || { active: 'ellipse', inactive: 'ellipse-outline', label: route.name };
            const focused = state.index === idx;
            const onPress = () => {
              const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
              if (!focused && !event.defaultPrevented) navigation.navigate(route.name);
            };
            return (
              <Pressable
                key={route.key}
                onPress={onPress}
                testID={`tab-${route.name}`}
                style={tbStyles.item}
              >
                <View style={[tbStyles.iconWrap, focused && tbStyles.iconWrapActive]}>
                  <Ionicons
                    name={focused ? meta.active : meta.inactive}
                    size={20}
                    color={focused ? '#FFFFFF' : theme.color.inkSoft}
                  />
                </View>
                <Text style={[tbStyles.label, focused && tbStyles.labelActive]}>{meta.label}</Text>
              </Pressable>
            );
          })}
        </View>
      </BlurView>
    </View>
  );
}

const tbStyles = StyleSheet.create({
  wrap: {
    position: 'absolute', left: 12, right: 12, bottom: 6,
    borderRadius: 28, overflow: 'hidden',
    borderWidth: 1, borderColor: 'rgba(234,228,217,0.6)',
    backgroundColor: 'rgba(253,251,247,0.75)',
    shadowColor: '#1A1C1E', shadowOpacity: 0.08, shadowRadius: 20, shadowOffset: { width: 0, height: 12 },
  },
  blur: { paddingTop: 10, paddingHorizontal: 6 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  item: { flex: 1, alignItems: 'center', gap: 4, paddingVertical: 4 },
  iconWrap: { width: 40, height: 32, borderRadius: theme.radius.pill, alignItems: 'center', justifyContent: 'center' },
  iconWrapActive: { backgroundColor: theme.color.ink },
  label: { fontSize: 10, fontWeight: '600', color: theme.color.inkSoft, letterSpacing: 0.3 },
  labelActive: { color: theme.color.ink },
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
