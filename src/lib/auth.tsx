import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { localAuth } from "@/lib/supabase";

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

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AppUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;

    localAuth.me().then((profile) => {
      if (!mounted) return;
      setUser(profile as AppUser | null);
      setLoading(false);
    });

    return () => {
      mounted = false;
    };
  }, []);

  const login: AuthCtx["login"] = async (email, senha) => {
    try {
      const profile = await localAuth.login(email.trim(), senha);
      setUser(profile as AppUser);
      return { ok: true };
    } catch {
      return { ok: false, error: "E-mail ou senha invalidos." };
    }
  };

  const logout = async () => {
    localAuth.logout();
    setUser(null);
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
