"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { api, TOKEN_KEY, type ApiEnvelope } from "@/lib/api";
import type { User } from "@/types";

interface Session { user: User; token: string }
interface MfaChallenge { mfa_required: true; email: string }

interface AuthState {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<User | MfaChallenge>;
  verifyMfa: (email: string, code: string) => Promise<User>;
  resendMfa: (email: string) => Promise<void>;
  register: (input: { name: string; email: string; password: string; password_confirmation: string; marketing_opt_in?: boolean }) => Promise<User>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
}

const Ctx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const accept = useCallback((s: Session) => {
    localStorage.setItem(TOKEN_KEY, s.token);
    setUser(s.user);
    return s.user;
  }, []);

  const refresh = useCallback(async () => {
    if (!localStorage.getItem(TOKEN_KEY)) {
      setUser(null);
      return;
    }
    try {
      const { data } = await api.get<ApiEnvelope<User>>("/auth/me");
      setUser(data.data);
    } catch {
      setUser(null);
    }
  }, []);

  useEffect(() => {
    Promise.resolve().then(refresh).finally(() => setLoading(false));
    const onUnauth = () => setUser(null);
    window.addEventListener("pms:unauthenticated", onUnauth);
    return () => window.removeEventListener("pms:unauthenticated", onUnauth);
  }, [refresh]);

  const value = useMemo<AuthState>(
    () => ({
      user,
      loading,
      refresh,
      async login(email, password) {
        const { data } = await api.post<ApiEnvelope<Session | MfaChallenge>>("/auth/login", { email, password });
        const d = data.data;
        return "mfa_required" in d ? d : accept(d);
      },
      async verifyMfa(email, code) {
        const { data } = await api.post<ApiEnvelope<Session>>("/auth/mfa/verify", { email, code });
        return accept(data.data);
      },
      async resendMfa(email) {
        await api.post("/auth/mfa/resend", { email });
      },
      async register(input) {
        const { data } = await api.post<ApiEnvelope<Session>>("/auth/register", input);
        return accept(data.data);
      },
      async logout() {
        try {
          await api.post("/auth/logout");
        } finally {
          localStorage.removeItem(TOKEN_KEY);
          setUser(null);
        }
      },
    }),
    [user, loading, refresh, accept],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useAuth must be used within AuthProvider");
  return c;
}
