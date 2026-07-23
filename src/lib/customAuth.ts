const FALLBACK_URL = "https://fppkjmnthxoajgvodksg.supabase.co";
const FALLBACK_KEY = "sb_publishable_f6PNf1RiBFPdA3F28ke5-w_CwiQRvGs";

const SUPABASE_URL = (import.meta.env.VITE_SUPABASE_URL as string) || FALLBACK_URL;
const API_KEY = (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string) || FALLBACK_KEY;

function getApiUrl(path: string) {
  if (path.startsWith("/api/")) {
    // For Vercel serverless functions
    return path;
  }
  // For Supabase Edge Functions
  return `${SUPABASE_URL}/functions/v1/custom-auth${path}`;
}

export type Role = "admin" | "teacher" | "student";

export interface SessionUser {
  account: string;
  role: Role;
  name: string;
  class_id: string | null;
}

export interface SessionState {
  token: string;
  user: SessionUser;
}

const KEY = "qsps_session_v1";

export function getSession(): SessionState | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function setSession(s: SessionState | null) {
  if (!s) sessionStorage.removeItem(KEY);
  else sessionStorage.setItem(KEY, JSON.stringify(s));
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const sess = getSession();
  const headers: Record<string, string> = {
    apikey: API_KEY,
    "Content-Type": "application/json",
    ...(init?.headers as any),
  };
  // Supabase Edge Functions gateway 需要 Authorization。
  // 未登入時，先用 anon key 當作 Authorization；登入後再換成自訂 session token。
  headers.authorization = sess?.token ? `Bearer ${sess.token}` : `Bearer ${API_KEY}`;

  const res = await fetch(getApiUrl(path), {
    ...init,
    headers,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data?.detail || data?.error || res.statusText;
    throw new Error(String(msg));
  }
  return data as T;
}
