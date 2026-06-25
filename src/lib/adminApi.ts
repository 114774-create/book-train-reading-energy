import { getSession } from "@/lib/customAuth";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const API_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;

function baseUrl() {
  return `${SUPABASE_URL}/functions/v1/admin-tools`;
}

export async function adminApi<T>(path: string, init?: RequestInit): Promise<T> {
  const sess = getSession();
  const headers: Record<string, string> = {
    apikey: API_KEY,
    "Content-Type": "application/json",
    ...(init?.headers as any),
  };
  headers.authorization = sess?.token ? `Bearer ${sess.token}` : `Bearer ${API_KEY}`;

  const res = await fetch(baseUrl() + path, {
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
