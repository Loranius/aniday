import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { preferencesStore } from './storage';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const isSupabaseConfigured = Boolean(url && anonKey && !url.includes('your-project-ref'));

/** null when VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY are missing — the UI then shows setup instructions. */
export const supabase: SupabaseClient | null = isSupabaseConfigured
  ? createClient(url!, anonKey!, {
      auth: {
        // The session must survive app restarts on Android.
        storage: {
          getItem: (k) => preferencesStore.get(k),
          setItem: (k, v) => preferencesStore.set(k, v),
          removeItem: (k) => preferencesStore.remove(k),
        },
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false,
      },
    })
  : null;
