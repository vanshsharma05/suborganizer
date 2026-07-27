import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { api, clearToken, getToken, saveToken, User, Subscription, ReminderItem } from './api';

type AuthCtx = {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  signup: (name: string, email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
  subs: Subscription[];
  refreshSubs: () => Promise<void>;
  reminders: ReminderItem[];
  refreshReminders: () => Promise<void>;
  setPro: (v: boolean) => void;
};

const Ctx = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [subs, setSubs] = useState<Subscription[]>([]);
  const [reminders, setReminders] = useState<ReminderItem[]>([]);

  const refreshUser = useCallback(async () => {
    try {
      const u = await api<User>('/auth/me');
      setUser(u);
    } catch {
      setUser(null);
      await clearToken();
    }
  }, []);

  const refreshSubs = useCallback(async () => {
    try {
      const s = await api<Subscription[]>('/subscriptions');
      setSubs(s);
    } catch (e) {
      // silently ignore
    }
  }, []);

  const refreshReminders = useCallback(async () => {
    try {
      const r = await api<{ items: ReminderItem[]; count: number }>('/reminders');
      setReminders(r.items);
    } catch (e) {
      // silently ignore
    }
  }, []);

  useEffect(() => {
    (async () => {
      const t = await getToken();
      if (t) {
        await refreshUser();
        await Promise.all([refreshSubs(), refreshReminders()]);
      }
      setLoading(false);
    })();
  }, [refreshUser, refreshSubs, refreshReminders]);

  const login = async (email: string, password: string) => {
    const r = await api<{ token: string; user: User }>('/auth/login', {
      method: 'POST', body: { email, password }, auth: false,
    });
    await saveToken(r.token);
    setUser(r.user);
    await Promise.all([refreshSubs(), refreshReminders()]);
  };

  const signup = async (name: string, email: string, password: string) => {
    const r = await api<{ token: string; user: User }>('/auth/signup', {
      method: 'POST', body: { name, email, password }, auth: false,
    });
    await saveToken(r.token);
    setUser(r.user);
    await Promise.all([refreshSubs(), refreshReminders()]);
  };

  const logout = async () => {
    await clearToken();
    setUser(null);
    setSubs([]);
    setReminders([]);
  };

  const setPro = (v: boolean) => setUser((u) => (u ? { ...u, is_pro: v } : u));

  return (
    <Ctx.Provider value={{ user, loading, login, signup, logout, refreshUser, subs, refreshSubs, reminders, refreshReminders, setPro }}>
      {children}
    </Ctx.Provider>
  );
}

export function useAuth() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAuth must be used within AuthProvider');
  return v;
}

// Helpers
export function monthlyEquivalent(sub: Subscription): number {
  if (sub.billing_cycle === 'yearly') return sub.amount / 12;
  if (sub.billing_cycle === 'weekly') return sub.amount * 4.33;
  return sub.amount;
}
