import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
const SUPABASE_FETCH_TIMEOUT_MS = import.meta.env.DEV ? 2500 : 10000;
const SUPABASE_FETCH_TIMEOUT_MESSAGE = "Supabase request timed out.";

export const hasSupabaseConfig = Boolean(supabaseUrl && supabaseAnonKey);

if (!hasSupabaseConfig) {
  console.warn("Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY.");
}

function createTimeoutSignal(parentSignal?: AbortSignal | null) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  const timeoutId = window.setTimeout(abort, SUPABASE_FETCH_TIMEOUT_MS);

  if (parentSignal?.aborted) {
    abort();
  } else {
    parentSignal?.addEventListener("abort", abort, { once: true });
  }

  return {
    signal: controller.signal,
    cleanup: () => {
      window.clearTimeout(timeoutId);
      parentSignal?.removeEventListener("abort", abort);
    },
  };
}

export const supabase = createClient(
  supabaseUrl || "https://missing-project-ref.supabase.co",
  supabaseAnonKey || "missing-anon-key",
  {
    global: {
      fetch: async (input, init) => {
        const { signal, cleanup } = createTimeoutSignal(init?.signal);
        let timeoutId = 0;

        try {
          const timeout = new Promise<Response>((_, reject) => {
            timeoutId = window.setTimeout(
              () => reject(new Error(SUPABASE_FETCH_TIMEOUT_MESSAGE)),
              SUPABASE_FETCH_TIMEOUT_MS,
            );
          });

          return await Promise.race([fetch(input, { ...init, signal }), timeout]);
        } finally {
          window.clearTimeout(timeoutId);
          cleanup();
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
