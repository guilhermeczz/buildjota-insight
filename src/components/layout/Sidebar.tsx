import { useState } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import {
  Activity,
  BarChart3,
  Bot,
  Boxes,
  GitCompareArrows,
  History,
  Home,
  LayoutDashboard,
  LogOut,
  Menu,
  Package,
  Settings,
  Store,
  Users,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/utils";

const NAV = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/familias", label: "Famílias", icon: Boxes },
  { to: "/produtos", label: "Produtos ConstruJota", icon: Package },
  { to: "/concorrentes", label: "Concorrentes", icon: Store },
  { to: "/mapeamentos", label: "Mapeamento de SKUs", icon: GitCompareArrows },
  { to: "/monitoramento-precos", label: "Monitoramento", icon: Activity },
  { to: "/historico", label: "Histórico de Preços", icon: History },
  { to: "/relatorios", label: "Relatórios", icon: BarChart3 },
  { to: "/execucoes-robo", label: "Execuções do Robô", icon: Bot },
  { to: "/usuarios", label: "Usuários", icon: Users },
  { to: "/configuracoes", label: "Configurações", icon: Settings },
];

function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  const { logout } = useAuth();
  const navigate = useNavigate();

  const handleLogout = async () => {
    await logout();
    toast.success("Sessão encerrada.");
    onNavigate?.();
    navigate("/login", { replace: true });
  };

  return (
    <aside className="flex h-full w-72 flex-col bg-sidebar text-sidebar-foreground">
      <div className="flex items-center gap-3 border-b border-sidebar-border px-6 py-6">
        <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-primary text-xl font-black text-primary-foreground shadow-md">
          CJ
        </div>
        <div className="leading-tight">
          <div className="text-base font-extrabold tracking-tight text-white">
            RADAR <span className="text-primary">CONSTRUJOTA</span>
          </div>
          <div className="text-[10px] uppercase tracking-[0.2em] text-sidebar-foreground/60">
            Atacadista
          </div>
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto px-3 py-4">
        <ul className="space-y-1">
          {NAV.map((item) => {
            const Icon = item.icon;
            return (
              <li key={item.to}>
                <NavLink
                  to={item.to}
                  onClick={onNavigate}
                  className={({ isActive }) =>
                    cn(
                      "group flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
                      isActive
                        ? "bg-primary text-primary-foreground shadow-sm"
                        : "text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                    )
                  }
                >
                  <Icon className="h-4.5 w-4.5 shrink-0" size={18} />
                  <span className="truncate">{item.label}</span>
                </NavLink>
              </li>
            );
          })}
        </ul>
      </nav>

      <div className="m-4 rounded-lg border border-sidebar-border bg-sidebar-accent p-4">
        <div className="flex items-center gap-2">
          <Home className="h-5 w-5 text-primary" />
          <div className="text-sm font-semibold text-white">ConstruJota Atacadista</div>
        </div>
        <button
          onClick={handleLogout}
          className="mt-3 inline-flex w-full items-center justify-start gap-2 rounded-md px-2 py-2 text-sm font-medium text-sidebar-foreground/80 transition hover:bg-sidebar-border hover:text-white"
        >
          <LogOut className="h-4 w-4" />
          Sair do sistema
        </button>
      </div>
    </aside>
  );
}

export default function Sidebar() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <div className="fixed inset-y-0 left-0 z-30 hidden lg:flex">
        <SidebarContent />
      </div>

      <button
        onClick={() => setOpen(true)}
        className="fixed left-4 top-4 z-40 inline-flex items-center justify-center rounded-md bg-secondary p-2 text-secondary-foreground shadow-md lg:hidden"
        aria-label="Abrir menu"
      >
        <Menu className="h-5 w-5" />
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex lg:hidden">
          <div className="absolute inset-0 bg-black/60" onClick={() => setOpen(false)} />
          <div className="relative">
            <button
              onClick={() => setOpen(false)}
              className="absolute -right-12 top-4 inline-flex items-center justify-center rounded-md bg-secondary p-2 text-secondary-foreground"
              aria-label="Fechar menu"
            >
              <X className="h-5 w-5" />
            </button>
            <SidebarContent onNavigate={() => setOpen(false)} />
          </div>
        </div>
      )}
    </>
  );
}
