import { useEffect, useMemo, useState } from "react";
import { Bell, Bot, ChevronDown, LogOut, UserCog } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { roleLabel, useAuth } from "@/lib/auth";
import { formatDateTime } from "@/lib/format";
import { supabase } from "@/lib/supabase";

type ExecucaoNotification = {
  id: string;
  status: "sucesso" | "parcial" | "erro" | "pendente";
  origem: string;
  iniciado_em: string;
  finalizado_em: string | null;
  total_processados: number;
  total_sucesso: number;
  total_erro: number;
  mensagem: string;
};

const statusBadge: Record<ExecucaoNotification["status"], string> = {
  sucesso: "bg-success text-success-foreground hover:bg-success",
  parcial: "bg-primary text-primary-foreground hover:bg-primary",
  erro: "bg-destructive text-destructive-foreground hover:bg-destructive",
  pendente: "bg-secondary-foreground/10 text-secondary-foreground hover:bg-secondary-foreground/10",
};

const seenExecutionKey = "radar:last-seen-execution";

export default function Topbar() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [execucoes, setExecucoes] = useState<ExecucaoNotification[]>([]);
  const [lastSeenExecutionId, setLastSeenExecutionId] = useState(() =>
    localStorage.getItem(seenExecutionKey),
  );

  const last = execucoes[0];
  const unreadCount = last && last.id !== lastSeenExecutionId ? 1 : 0;

  useEffect(() => {
    let mounted = true;

    const loadExecucoes = async () => {
      const { data } = await supabase
        .from("execucoes_robo")
        .select(
          "id,status,origem,iniciado_em,finalizado_em,total_processados,total_sucesso,total_erro,mensagem",
        )
        .order("iniciado_em", { ascending: false })
        .limit(3);

      if (mounted) setExecucoes((data ?? []) as ExecucaoNotification[]);
    };

    loadExecucoes();

    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") loadExecucoes();
    }, 120000);

    return () => {
      mounted = false;
      window.clearInterval(interval);
    };
  }, []);

  const initials = useMemo(
    () =>
      user
        ? user.nome
            .split(" ")
            .map((n) => n[0])
            .slice(0, 2)
            .join("")
            .toUpperCase()
        : "CJ",
    [user],
  );

  const handleLogout = async () => {
    await logout();
    toast.success("Sessão encerrada.");
    navigate("/login", { replace: true });
  };

  const markNotificationsAsRead = () => {
    if (!last) return;
    localStorage.setItem(seenExecutionKey, last.id);
    setLastSeenExecutionId(last.id);
  };

  return (
    <header className="sticky top-0 z-20 border-b bg-secondary text-secondary-foreground">
      <div className="flex flex-col gap-3 px-6 py-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="pl-12 lg:pl-0">
          <h1 className="text-xl lg:text-2xl font-bold text-primary leading-tight">
            Radar ConstruJota
          </h1>
          <p className="text-xs lg:text-sm text-secondary-foreground/70">
            Painel de comparação e monitoramento inteligente de preços
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-4">
          <div className="text-right text-xs">
            <div className="text-secondary-foreground/60">Última atualização</div>
            <div className="font-medium">
              {last ? formatDateTime(last.finalizado_em ?? last.iniciado_em) : "Sem coletas"}
            </div>
            <Badge
              className={
                last
                  ? statusBadge[last.status]
                  : "mt-1 bg-secondary-foreground/10 text-secondary-foreground hover:bg-secondary-foreground/10"
              }
            >
              {last?.status ?? "Pendente"}
            </Badge>
          </div>

          <DropdownMenu onOpenChange={(open) => open && markNotificationsAsRead()}>
            <DropdownMenuTrigger asChild>
              <button className="relative inline-flex h-10 w-10 items-center justify-center rounded-full bg-secondary-foreground/10 transition hover:bg-secondary-foreground/15">
                <Bell className="h-5 w-5" />
                {unreadCount > 0 && (
                  <span className="absolute -top-0.5 -right-0.5 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold text-primary-foreground">
                    {unreadCount}
                  </span>
                )}
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-80">
              <DropdownMenuLabel>Execuções do robô</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {execucoes.length === 0 ? (
                <div className="px-2 py-6 text-center text-sm text-muted-foreground">
                  Nenhuma execução registrada.
                </div>
              ) : (
                execucoes.map((execucao) => (
                  <DropdownMenuItem
                    key={execucao.id}
                    className="flex cursor-pointer items-start gap-3 py-3"
                    onClick={() => {
                      markNotificationsAsRead();
                      navigate("/execucoes-robo");
                    }}
                  >
                    <Bot className="mt-0.5 h-4 w-4 text-primary" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate font-medium">
                          {execucao.status === "pendente"
                            ? "Coleta em andamento"
                            : "Coleta finalizada"}
                        </span>
                        <Badge className={statusBadge[execucao.status]}>{execucao.status}</Badge>
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        {formatDateTime(execucao.finalizado_em ?? execucao.iniciado_em)}
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        {execucao.total_processados} processados · {execucao.total_sucesso} sucesso
                        · {execucao.total_erro} erros
                      </div>
                      {execucao.mensagem && (
                        <div className="mt-1 truncate text-xs text-muted-foreground">
                          {execucao.mensagem}
                        </div>
                      )}
                    </div>
                  </DropdownMenuItem>
                ))
              )}
            </DropdownMenuContent>
          </DropdownMenu>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="flex items-center gap-2 rounded-lg bg-secondary-foreground/10 px-3 py-2 transition hover:bg-secondary-foreground/15">
                <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary font-bold text-primary-foreground">
                  {initials}
                </div>
                <div className="text-left text-xs leading-tight">
                  <div className="font-semibold">{user?.nome ?? "Visitante"}</div>
                  <div className="text-secondary-foreground/60">
                    {user ? roleLabel[user.role] : "—"}
                  </div>
                </div>
                <ChevronDown className="h-4 w-4 text-secondary-foreground/60" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuLabel>{user?.email}</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => navigate("/usuarios")}>
                <UserCog className="mr-2 h-4 w-4" />
                Gerenciar usuários
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={handleLogout}
                className="text-destructive focus:text-destructive"
              >
                <LogOut className="mr-2 h-4 w-4" />
                Sair
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </header>
  );
}
