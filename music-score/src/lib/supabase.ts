import { createClient, SupabaseClient } from '@supabase/supabase-js';

let _client: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient {
  if (!_client) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !key || url.startsWith('your_') || key.startsWith('your_')) {
      throw new Error('Supabase not configured: fill in .env.local');
    }
    _client = createClient(url, key);
  }
  return _client;
}
