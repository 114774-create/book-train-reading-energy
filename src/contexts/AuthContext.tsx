import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { api, getSession, setSession, type SessionState, type SessionUser } from "@/lib/customAuth";

interface AuthCtx {
  loading: boolean;
  session: SessionState | null;
  user: SessionUser | null;
  logout: () => Promise<void>;
  set: (s: SessionState | null) => void;
}

const Ctx = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [session, setSess] = useState<SessionState | null>(() => getSession());

  useEffect(() => {
    let alive = true;
    async function boot() {
      const s = getSession();
      if (!alive) return;
      if (!s) {
        setSess(null);
        setLoading(false);
        return;
      }
      try {
        const r = await api<{ ok: boolean; user: SessionUser }>("/me");
        const merged: SessionState = { token: s.token, user: r.user };
        setSession(merged);
        setSess(merged);
      } catch {
        setSession(null);
        setSess(null);
      } finally {
        if (alive) setLoading(false);
      }
    }
    boot();
    return () => {
      alive = false;
    };
  }, []);

  const value = useMemo<AuthCtx>(
    () => ({
      loading,
      session,
      user: session?.user ?? null,
      set: (s) => {
        setSession(s);
        setSess(s);
      },
      logout: async () => {
        try {
          await api("/logout", { method: "POST" });
        } catch {
          // ignore
        }
        setSession(null);
        setSess(null);
      },
    }),
    [loading, session]
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAuth must be used within AuthProvider");
  return v;
}
