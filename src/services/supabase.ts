import { createClient } from '@supabase/supabase-js';
import Constants from 'expo-constants';

// Prefer app.config.js `extra` values; fall back to EXPO_PUBLIC_* env vars,
// which Metro inlines automatically on modern Expo SDKs with no extra Babel
// config needed. The previous fallback read `process.env.SUPABASE_URL`,
// which is never populated in an Expo client bundle — only the
// EXPO_PUBLIC_ prefix is.
const supabaseUrl =
  Constants.expoConfig?.extra?.supabaseUrl || process.env.EXPO_PUBLIC_SUPABASE_URL;
const supabaseAnonKey =
  Constants.expoConfig?.extra?.supabaseAnonKey || process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    'Missing Supabase environment variables. Set extra.supabaseUrl / extra.supabaseAnonKey ' +
      'in app.config.js, or EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_ANON_KEY in your .env file.'
  );
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
