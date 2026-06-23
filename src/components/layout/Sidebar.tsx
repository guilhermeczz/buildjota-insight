import { NavLink } from "react-router-dom";
import {
  LayoutDashboard,
  Boxes,
  Package,
  Store,
  GitCompareArrows,
  History,
  BarChart3,
  Bot,
  Settings,
  Menu,
  X,
  Home,
} from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";

const NAV = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/familias", label: "Famílias", icon: Boxes },
  { to: "/produtos", label: "Produtos ConstruJota", icon: Package },
  { to: "/fornecedores", label: "Fornecedores", icon: Store },
  { to: "/mapeamentos", label: "Mapeamento de SKUs", icon: GitCompareArrows },
  { to: "/historico", label: "Histórico de Preços", icon: History },
  { to: "/relatorios", label: "Relatórios", icon: BarChart3 },
  { to: "/execucoes-robo", label: "Execuções do Robô", icon: Bot },
  { to: "/configuracoes", label: "Configurações", icon: Settings },
];

function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <aside className="flex h-full w-72 flex-col bg-sidebar text-sidebar-foreground">
      {/* Logo */}
      <div className="flex items-center gap-3 px-6 py-6 border-b border-sidebar-border">
        <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-primary text-primary-foreground font-black text-xl shadow-md">
          CJ
        </div>
        <div className="leading-tight">
          <div className="text-base font-extrabold tracking-tight text-white">
            CONSTRU<span className="text-primary">JOTA</span>
          </div>
          <div className="text-[10px] uppercase tracking-[0.2em] text-sidebar-foreground/60">
            Atacadista
          </div>
        </div>
      </div>

      {/* Nav */}
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

      {/* Footer card */}
      <div className="m-4 rounded-lg border border-sidebar-border bg-sidebar-accent p-4 text-center">
        <Home className="mx-auto mb-2 h-5 w-5 text-primary" />
        <div className="text-sm font-semibold text-white">ConstruJota Atacadista</div>
        <div className="mt-1 text-xs text-sidebar-foreground/60">
          Inteligência para vender mais e comprar melhor.
        </div>
      </div>
    </aside>
  );
}

export default function Sidebar() {
  const [open, setOpen] = useState(false);
  return (
    <>
      {/* Desktop */}
      <div className="hidden lg:flex fixed inset-y-0 left-0 z-30">
        <SidebarContent />
      </div>

      {/* Mobile toggle button */}
      <button
        onClick={() => setOpen(true)}
        className="lg:hidden fixed top-4 left-4 z-40 inline-flex items-center justify-center rounded-md bg-secondary text-secondary-foreground p-2 shadow-md"
        aria-label="Abrir menu"
      >
        <Menu className="h-5 w-5" />
      </button>

      {/* Mobile drawer */}
      {open && (
        <div className="lg:hidden fixed inset-0 z-50 flex">
          <div
            className="absolute inset-0 bg-black/60"
            onClick={() => setOpen(false)}
          />
          <div className="relative">
            <button
              onClick={() => setOpen(false)}
              className="absolute -right-12 top-4 inline-flex items-center justify-center rounded-md bg-secondary text-secondary-foreground p-2"
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
