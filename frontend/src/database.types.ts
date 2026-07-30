/**
 * Shape of the Postgres schema defined in supabase/schema.sql.
 *
 * Without this, supabase-js resolves every table name to `never` and each query
 * fails to typecheck. Keep it in sync when the SQL changes — or replace it with
 * generated output from `supabase gen types typescript`.
 */

export type BillingCycle = 'weekly' | 'monthly' | 'yearly';
export type SubStatus = 'active' | 'paused' | 'cancelled';

type ProfileRow = {
  id: string;
  name: string | null;
  is_pro: boolean;
  primary_currency: string;
  created_at: string;
};

type SubscriptionRow = {
  id: string;
  user_id: string;
  name: string;
  amount: number;
  currency: string;
  billing_cycle: BillingCycle;
  category: string;
  next_renewal: string;
  domain: string | null;
  brand_color: string | null;
  notes: string | null;
  status: SubStatus;
  reminder_days_before: number;
  snoozed_until: string | null;
  is_trial: boolean;
  trial_ends: string | null;
  created_at: string;
};

type PriceChangeRow = {
  id: string;
  subscription_id: string;
  user_id: string;
  old_amount: number;
  new_amount: number;
  currency: string;
  changed_at: string;
};

export type Database = {
  public: {
    Tables: {
      profiles: {
        Row: ProfileRow;
        Insert: Partial<ProfileRow> & { id: string };
        Update: Partial<Omit<ProfileRow, 'id'>>;
        Relationships: [];
      };
      subscriptions: {
        // Columns carrying a DEFAULT in schema.sql are optional on insert.
        Insert: {
          id?: string;
          user_id: string;
          name: string;
          amount: number;
          currency?: string;
          billing_cycle: BillingCycle;
          category: string;
          next_renewal: string;
          domain?: string | null;
          brand_color?: string | null;
          notes?: string | null;
          status?: SubStatus;
          reminder_days_before?: number;
          snoozed_until?: string | null;
          is_trial?: boolean;
          trial_ends?: string | null;
          created_at?: string;
        };
        Row: SubscriptionRow;
        Update: Partial<Omit<SubscriptionRow, 'id' | 'user_id'>>;
        Relationships: [];
      };
      // Rows are written only by the trigger in schema.sql, so there is no
      // client-side insert or update shape to describe.
      price_changes: {
        Row: PriceChangeRow;
        Insert: never;
        Update: never;
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};
