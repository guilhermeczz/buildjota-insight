import { Bell, ChevronDown } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { execucoes, formatDateTime } from "@/lib/mock-data";

export default function Topbar() {
  const last = execucoes[0];
  return (
    <header className="sticky top-0 z-20 border-b bg-secondary text-secondary-foreground">
      <div className="flex flex-col gap-3 px-6 py-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="pl-12 lg:pl-0">
          <h1 className="text-xl lg:text-2xl font-bold text-primary leading-tight">
            ConstruJota Price Intelligence
          </h1>
          <p className="text-xs lg:text-sm text-secondary-foreground/70">
            Painel de comparação e monitoramento inteligente de preços
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-4">
          <div className="text-right text-xs">
            <div className="text-secondary-foreground/60">Última atualização</div>
            <div className="font-medium">{formatDateTime(last.finalizado_em)}</div>
            <Badge className="mt-1 bg-success text-success-foreground hover:bg-success">
              Atualizado
            </Badge>
          </div>
          <button className="relative inline-flex h-10 w-10 items-center justify-center rounded-full bg-secondary-foreground/10 hover:bg-secondary-foreground/15 transition">
            <Bell className="h-5 w-5" />
            <span className="absolute -top-0.5 -right-0.5 inline-flex h-5 w-5 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-primary-foreground">
              3
            </span>
          </button>
          <div className="flex items-center gap-2 rounded-lg bg-secondary-foreground/10 px-3 py-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary font-bold text-primary-foreground">
              CJ
            </div>
            <div className="text-xs leading-tight">
              <div className="font-semibold">ConstruJota</div>
              <div className="text-secondary-foreground/60">Administrador</div>
            </div>
            <ChevronDown className="h-4 w-4 text-secondary-foreground/60" />
          </div>
        </div>
      </div>
    </header>
  );
}
