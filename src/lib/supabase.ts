import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
const SUPABASE_FETCH_TIMEOUT_MS = 10000;

export const hasSupabaseConfig = Boolean(supabaseUrl && supabaseAnonKey);

if (!hasSupabaseConfig) {
  console.warn("Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY.");
}

export const supabase = createClient(
  supabaseUrl || "https://missing-project-ref.supabase.co",
  supabaseAnonKey || "missing-anon-key",
  {
    global: {
      fetch: async (input, init) => {
        const controller = new AbortController();
        const timeoutId = window.setTimeout(() => controller.abort(), SUPABASE_FETCH_TIMEOUT_MS);

        try {
          return await fetch(input, { ...init, signal: init?.signal ?? controller.signal });
        } finally {
          window.clearTimeout(timeoutId);
        }
      },
    },
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
    },
  },
);
