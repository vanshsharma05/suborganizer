import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

const TOKEN_KEY = 'suborganizer_token';

const isWeb = Platform.OS === 'web';

export async function saveToken(token: string) {
  if (isWeb) return AsyncStorage.setItem(TOKEN_KEY, token);
  return SecureStore.setItemAsync(TOKEN_KEY, token);
}
export async function getToken(): Promise<string | null> {
  if (isWeb) return AsyncStorage.getItem(TOKEN_KEY);
  return SecureStore.getItemAsync(TOKEN_KEY);
}
export async function clearToken() {
  if (isWeb) return AsyncStorage.removeItem(TOKEN_KEY);
  return SecureStore.deleteItemAsync(TOKEN_KEY);
}

const BASE = process.env.EXPO_PUBLIC_BACKEND_URL;

export async function api<T = any>(
  path: string,
  opts: { method?: string; body?: any; auth?: boolean } = {},
): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (opts.auth !== false) {
    const token = await getToken();
    if (token) headers.Authorization = `Bearer ${token}`;
  }
  const res = await fetch(`${BASE}/api${path}`, {
    method: opts.method || 'GET',
    headers,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : {};
  if (!res.ok) {
    throw new Error(data.detail || `Request failed (${res.status})`);
  }
  return data as T;
}

export type Subscription = {
  id: string;
  name: string;
  amount: number;
  billing_cycle: 'monthly' | 'yearly' | 'weekly';
  category: string;
  next_renewal: string;
  domain?: string | null;
  brand_color?: string | null;
  notes?: string | null;
  status: 'active' | 'paused' | 'cancelled';
  reminder_days_before?: number;
  snoozed_until?: string | null;
  created_at?: string;
};

export type ReminderItem = Subscription & { days_left: number; urgency: 'overdue' | 'today' | 'soon' | 'upcoming' };

export type User = { id: string; email: string; name: string; is_pro: boolean };
