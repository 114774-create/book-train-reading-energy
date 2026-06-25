import { createClient } from "@supabase/supabase-js";

// IMPORTANT
// - publishable key 不是機密（可公開），但仍建議用環境變數注入。
// - 為了避免部署環境忘記設定 env 造成白畫面，這裡提供 fallback。

const FALLBACK_URL = "https://fppkjmnthxoajgvodksg.supabase.co";
const FALLBACK_KEY = "sb_publishable_f6PNf1RiBFPdA3F28ke5-w_CwiQRvGs";

const url = (import.meta.env.VITE_SUPABASE_URL as string) || FALLBACK_URL;
const key = (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string) || FALLBACK_KEY;

if (!import.meta.env.VITE_SUPABASE_URL || !import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY) {
  // eslint-disable-next-line no-console
  console.warn(
    "Missing Supabase env. Using fallback URL/key. " +
      "(You can override via VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY)"
  );
}

export const supabase = createClient(url, key, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});
