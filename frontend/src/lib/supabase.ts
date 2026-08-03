import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL || 'https://jyhqogjqtgtvlnaursey.supabase.co';
const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || '';

export const isSupabaseConfigured = Boolean(url && publishableKey);

export const supabase = createClient(
  url,
  publishableKey || 'dummy-local-key'
);
