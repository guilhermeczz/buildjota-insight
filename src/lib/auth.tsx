import { createContext, useContext, useEffect, useState, ReactNode } from "react";

export type UserRole = "admin" | "operador" | "visualizador";

export type AppUser = {
  id: string;
  nome: string;
  email: string;
  role: UserRole;
  senha: string; // mock only
  ativo: boolean;
  created_at: string;
};

const USERS_KEY = "radar_cj_users";
const SESSION_KEY = "radar_cj_session";

const SEED_USERS: AppUser[] = [
  {
    id: "u1",
    nome: "Administrador",
    email: "admin@construjota.com.br",
    role: "admin",
    senha: "admin123",
    ativo: true,
    created_at: new Date().toISOString(),
  },
  {
    id: "u2",
    nome: "João Operador",
    email: "joao@construjota.com.br",
    role: "operador",
    senha: "operador123",
    ativo: true,
    created_at: new Date().toISOString(),
  },
  {
    id: "u3",
    nome: "Maria Visualizadora",
    email: "maria@construjota.com.br",
    role: "visualizador",
    senha: "viewer123",
    ativo: false,
    created_at: new Date().toISOString(),
  },
];

export function loadUsers(): AppUser[] {
  try {
    const raw = localStorage.getItem(USERS_KEY);
    if (!raw) {
      localStorage.setItem(USERS_KEY, JSON.stringify(SEED_USERS));
      return SEED_USERS;
    }
    return JSON.parse(raw);
  } catch {
    return SEED_USERS;
  }
}

export function saveUsers(users: AppUser[]) {
  localStorage.setItem(USERS_KEY, JSON.stringify(users));
}

type SessionUser = Omit<AppUser, "senha">;

type AuthCtx = {
  user: SessionUser | null;
  loading: boolean;
  login: (email: string, senha: string) => Promise<{ ok: boolean; error?: string }>;
  logout: () => void;
};

const Ctx = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadUsers();
    try {
      const raw = localStorage.getItem(SESSION_KEY);
      if (raw) setUser(JSON.parse(raw));
    } catch {}
    setLoading(false);
  }, []);

  const login: AuthCtx["login"] = async (email, senha) => {
    await new Promise((r) => setTimeout(r, 700)); // UX feel
    const users = loadUsers();
    const found = users.find(
      (u) => u.email.toLowerCase() === email.toLowerCase().trim(),
    );
    if (!found) return { ok: false, error: "Usuário não encontrado." };
    if (!found.ativo) return { ok: false, error: "Usuário inativo. Contate o administrador." };
    if (found.senha !== senha) return { ok: false, error: "Senha incorreta." };
    const { senha: _s, ...rest } = found;
    setUser(rest);
    localStorage.setItem(SESSION_KEY, JSON.stringify(rest));
    return { ok: true };
  };

  const logout = () => {
    setUser(null);
    localStorage.removeItem(SESSION_KEY);
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
