import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';
import type { Database } from '../types/database.types';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  // Fails fast and loudly instead of silently hitting an undefined backend —
  // this is the #1 cause of "works on my machine" DB mismatches.
  throw new Error(
    'Missing EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_ANON_KEY. Copy .env.example to .env and fill in your existing SafeHer Supabase project values.'
  );
}

export const supabase = createClient<Database>(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    // There's no browser address bar in React Native to parse a session
    // out of — email confirmation / password recovery links are handled
    // manually via lib/deepLinks.ts (Linking + exchangeCodeForSession)
    // instead of Supabase's own URL auto-detection.
    detectSessionInUrl: false,
    // PKCE over the older implicit flow: the email link carries a single
    // opaque `code` that's exchanged for a session using a verifier this
    // device already holds, rather than the access/refresh tokens
    // themselves riding in the URL where they could end up in device
    // logs or be replayed by anything else that can open safeher:// links.
    flowType: 'pkce',
  },
});
