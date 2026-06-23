import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";

export type UserRole = "admin" | "operador" | "visualizador";

export type AppUser = {
  id: string;
  nome: string;
  email: string;
  role: UserRole;
  ativo: boolean;
  created_at: string;
};

type AuthCtx = {
  user: AppUser | null;
  loading: boolean;
  login: (email: string, senha: string) => Promise<{ ok: boolean; error?: string }>;
  logout: () => Promise<void>;
};

const Ctx = createContext<AuthCtx | null>(null);

async function loadProfile(session: Session | null): Promise<AppUser | null> {
  if (!session?.user) return null;

  const { data, error } = await supabase
    .from("profiles")
    .select("id,nome,email,role,ativo,created_at")
    .eq("id", session.user.id)
    .maybeSingle();

  if (error || !data || !data.ativo) {
    await supabase.auth.signOut();
    return null;
  }

  return data as AppUser;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AppUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;

    const refreshUser = async (session: Session | null) => {
      const profile = await loadProfile(session);
      if (!mounted) return;
      setUser(profile);
      setLoading(false);
    };

    supabase.auth.getSession().then(({ data }) => refreshUser(data.session));

    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      refreshUser(session);
    });

    return () => {
      mounted = false;
      data.subscription.unsubscribe();
    };
  }, []);

  const login: AuthCtx["login"] = async (email, senha) => {
    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password: senha,
    });

    if (error) return { ok: false, error: "E-mail ou senha inválidos." };
    return { ok: true };
  };

  const logout = async () => {
    setUser(null);
    await supabase.auth.signOut();
  };

  return <Ctx.Provider value={{ user, loading, login, logout }}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}

export const roleLabel: Record<UserRole, string> = {
  admin: "Administrador",
  operador: "Operador",
  visualizador: "Visualizador",
};
