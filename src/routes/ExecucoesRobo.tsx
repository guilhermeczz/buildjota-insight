import { useCallback, useEffect, useState } from "react";
import PageHeader from "@/components/layout/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatDateTime, toDateString, toTimestamp } from "@/lib/format";
import { apiClient } from "@/lib/api-client";
import { Activity, CalendarClock, Loader2, RefreshCw } from "lucide-react";
import { Link } from "react-router-dom";
import { toast } from "sonner";

const WORKER_HEALTH_INTERVAL_MS = 5000;
const RECENT_PENDING_EXECUTION_MS = 2 * 60 * 1000;

type Execucao = {
  id: string;
  status: "sucesso" | "parcial" | "erro" | "pendente";
  origem: "manual" | "edge_function" | "worker" | "agendado";
  iniciado_em: string;
  finalizado_em: string | null;
  total_processados: number;
  total_sucesso: number;
  total_erro: number;
  mensagem: string;
  tempo_execucao_segundos: number;
};

type Familia = {
  id: string;
  nome: string;
};

type HistoricoExecucao = {
  coletado_em: string;
  mapeamentos_sku?: {
    produtos?: {
      familia_id: string | null;
    } | null;
  } | null;
};

type StatusFilter = "todos" | Execucao["status"];

type WorkerRun = {
  id: string;
  kind: "agendado" | string;
  startedAt: string;
  updatedAt?: string;
  message?: string;
};

type WorkerHealth = {
  ok: boolean;
  running: boolean;
  currentRun?: WorkerRun | null;
  scheduleTimezone?: string;
  local?: {
    date: string;
    time: string;
    weekday: number;
  };
};

function durationLabel(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, "0")}`;
}

function statusBadge(status: Execucao["status"]) {
  if (status === "sucesso") {
    return <Badge className="bg-success text-success-foreground">Sucesso</Badge>;
  }
  if (status === "parcial") {
    return <Badge className="bg-primary text-primary-foreground">Parcial</Badge>;
  }
  if (status === "erro") {
    return <Badge variant="destructive">Erro</Badge>;
  }
  return <Badge variant="secondary">Buscando</Badge>;
}

function workerRequestHeaders() {
  const token = localStorage.getItem("radar_auth_token");
  return {
    "content-type": "application/json",
    ...(token ? { authorization: `Bearer ${token}` } : {}),
  };
}

async function requestWorkerHealth(healthUrl: string) {
  const response = await fetch(healthUrl, {
    method: "GET",
    headers: workerRequestHeaders(),
  });
  if (!response.ok) throw new Error("Worker indisponivel");
  return (await response.json()) as WorkerHealth;
}

export default function ExecucoesRobo() {
  const [execucoes, setExecucoes] = useState<Execucao[]>([]);
  const [familias, setFamilias] = useState<Familia[]>([]);
  const [historicosExecucao, setHistoricosExecucao] = useState<HistoricoExecucao[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("todos");
  const [familiaFilter, setFamiliaFilter] = useState("todos");
  const [workerHealth, setWorkerHealth] = useState<WorkerHealth | null>(null);
  const [healthLoading, setHealthLoading] = useState(false);

  const apiBaseUrl = String(import.meta.env.VITE_API_URL ?? "").replace(/\/+$/, "");
  const healthUrl = `${apiBaseUrl}/api/worker/health`;

  const refreshWorkerHealth = useCallback(async () => {
    setHealthLoading(true);
    try {
      setWorkerHealth(await requestWorkerHealth(healthUrl));
    } catch {
      setWorkerHealth(null);
    } finally {
      setHealthLoading(false);
    }
  }, [healthUrl]);

  async function refreshExecucoes() {
    const [execucoesResult, historicosResult] = await Promise.all([
      apiClient
        .from("execucoes_robo")
        .select(
          "id,status,origem,iniciado_em,finalizado_em,total_processados,total_sucesso,total_erro,mensagem,tempo_execucao_segundos",
        )
        .order("iniciado_em", { ascending: false })
        .limit(60),
      apiClient
        .from("historico_precos")
        .select("coletado_em,mapeamentos_sku(produtos(familia_id))")
        .order("coletado_em", { ascending: false })
        .limit(300),
    ]);
    const { data, error } = execucoesResult;

    if (error) {
      toast.error("Não foi possível carregar as execuções");
      setLoading(false);
      return;
    }

    if (!historicosResult.error) {
      setHistoricosExecucao(
        ((historicosResult.data ?? []) as HistoricoExecucao[]).map((historico) => ({
          ...historico,
          coletado_em: toDateString(historico.coletado_em),
        })),
      );
    }

    const nextExecucoes = ((data ?? []) as Execucao[]).map((execucao) => ({
      ...execucao,
      iniciado_em: toDateString(execucao.iniciado_em),
      finalizado_em: execucao.finalizado_em ? toDateString(execucao.finalizado_em) : null,
      total_processados: Number(execucao.total_processados ?? 0),
      total_sucesso: Number(execucao.total_sucesso ?? 0),
      total_erro: Number(execucao.total_erro ?? 0),
      tempo_execucao_segundos: Number(execucao.tempo_execucao_segundos ?? 0),
    }));
    setExecucoes(nextExecucoes);
    setLoading(false);
  }

  useEffect(() => {
    void refreshExecucoes();
    void loadFamilies();
    void refreshWorkerHealth();
  }, [refreshWorkerHealth]);

  useEffect(() => {
    const hasPendingExecution =
      workerHealth?.running === true ||
      execucoes.some((execucao) => execucao.status === "pendente" || !execucao.finalizado_em);

    const interval = window.setInterval(
      () => {
        void refreshExecucoes();
      },
      hasPendingExecution ? 5000 : 60000,
    );

    return () => window.clearInterval(interval);
  }, [execucoes, workerHealth?.running]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") void refreshWorkerHealth();
    }, WORKER_HEALTH_INTERVAL_MS);

    return () => window.clearInterval(interval);
  }, [refreshWorkerHealth]);

  async function loadFamilies() {
    const result = await apiClient
      .from("familias")
      .select("id,nome")
      .eq("ativo", true)
      .order("nome");

    if (result.error) {
      toast.error("Não foi possível carregar as famílias");
      return;
    }

    setFamilias((result.data ?? []) as Familia[]);
  }

  function familiasDaExecucao(execucao: Execucao) {
    const startedAt = toTimestamp(execucao.iniciado_em) - 1000;
    const finishedAt = toTimestamp(execucao.finalizado_em ?? execucao.iniciado_em) + 5000;

    return new Set(
      historicosExecucao
        .filter((historico) => {
          const collectedAt = toTimestamp(historico.coletado_em);
          return collectedAt >= startedAt && collectedAt <= finishedAt;
        })
        .map((historico) => historico.mapeamentos_sku?.produtos?.familia_id)
        .filter(Boolean) as string[],
    );
  }

  const healthExecution =
    workerHealth?.running && workerHealth.currentRun
      ? ({
          id: workerHealth.currentRun.id,
          status: "pendente",
          origem: "agendado",
          iniciado_em: toDateString(workerHealth.currentRun.startedAt),
          finalizado_em: null,
          total_processados: 0,
          total_sucesso: 0,
          total_erro: 0,
          mensagem: workerHealth.currentRun.message ?? "Coleta em andamento...",
          tempo_execucao_segundos: 0,
        } satisfies Execucao)
      : null;

  function isActiveDbExecution(execucao: Execucao) {
    if (execucao.finalizado_em && execucao.status !== "pendente") return false;

    const startedAt = toTimestamp(execucao.iniciado_em);
    if (!startedAt) return false;

    const currentRunStartedAt = toTimestamp(workerHealth?.currentRun?.startedAt);
    if (workerHealth?.running === true && currentRunStartedAt) {
      return startedAt >= currentRunStartedAt - 60_000;
    }

    return Date.now() - startedAt <= RECENT_PENDING_EXECUTION_MS;
  }

  const dbCurrentExecution = execucoes.find(isActiveDbExecution) ?? null;
  const syntheticExecution = !dbCurrentExecution ? healthExecution : null;
  const currentExecution = dbCurrentExecution ?? healthExecution ?? null;
  const visibleExecucoes = (
    syntheticExecution ? [syntheticExecution, ...execucoes] : execucoes
  ).filter((execucao) => {
    if (statusFilter !== "todos" && execucao.status !== statusFilter) return false;
    if (familiaFilter !== "todos" && !familiasDaExecucao(execucao).has(familiaFilter)) {
      return false;
    }
    return true;
  });

  const workerBusy = Boolean(currentExecution) || workerHealth?.running === true;
  const lastExecution = execucoes[0] ?? null;
  const panelExecution = currentExecution ?? lastExecution;
  const panelStartedAt = panelExecution ? toTimestamp(panelExecution.iniciado_em) : 0;
  const panelFinishedAt = panelExecution?.finalizado_em
    ? toTimestamp(panelExecution.finalizado_em)
    : 0;
  const panelSeconds = panelExecution
    ? Math.max(
        0,
        Math.round(((panelFinishedAt || Date.now()) - (panelStartedAt || Date.now())) / 1000),
      )
    : 0;

  return (
    <>
      <PageHeader
        title="Execuções do Robô"
        description="Histórico das coletas iniciadas exclusivamente pelas agendas configuradas."
      />

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
        <Card className="shadow-sm">
          <CardContent className="space-y-4 p-5">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Status</Label>
                <select
                  value={statusFilter}
                  onChange={(event) => setStatusFilter(event.target.value as StatusFilter)}
                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm outline-none transition-colors focus:ring-1 focus:ring-ring"
                >
                  <option value="todos">Todos os status</option>
                  <option value="sucesso">Sucesso</option>
                  <option value="parcial">Parcial</option>
                  <option value="erro">Erro</option>
                  <option value="pendente">Buscando</option>
                </select>
              </div>

              <div className="space-y-1.5">
                <Label>Família</Label>
                <select
                  value={familiaFilter}
                  onChange={(event) => setFamiliaFilter(event.target.value)}
                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm outline-none transition-colors focus:ring-1 focus:ring-ring"
                >
                  <option value="todos">Todas as famílias</option>
                  {familias.map((familia) => (
                    <option key={familia.id} value={familia.id}>
                      {familia.nome}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Inicio</TableHead>
                    <TableHead>Fim</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Origem</TableHead>
                    <TableHead>Processados</TableHead>
                    <TableHead>Sucesso</TableHead>
                    <TableHead>Erros</TableHead>
                    <TableHead>Tempo</TableHead>
                    <TableHead>Mensagem</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loading && (
                    <TableRow>
                      <TableCell colSpan={9} className="py-10 text-center text-muted-foreground">
                        Carregando execuções...
                      </TableCell>
                    </TableRow>
                  )}
                  {!loading && visibleExecucoes.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={9} className="py-10 text-center text-muted-foreground">
                        Nenhuma execução encontrada.
                      </TableCell>
                    </TableRow>
                  )}
                  {visibleExecucoes.map((execucao) => (
                    <TableRow key={execucao.id}>
                      <TableCell className="whitespace-nowrap text-xs">
                        {formatDateTime(execucao.iniciado_em)}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-xs">
                        {execucao.finalizado_em ? formatDateTime(execucao.finalizado_em) : "-"}
                      </TableCell>
                      <TableCell>{statusBadge(execucao.status)}</TableCell>
                      <TableCell>
                        <Badge variant="outline">{execucao.origem}</Badge>
                      </TableCell>
                      <TableCell>{execucao.total_processados}</TableCell>
                      <TableCell className="text-success">{execucao.total_sucesso}</TableCell>
                      <TableCell className="text-destructive">{execucao.total_erro}</TableCell>
                      <TableCell className="text-xs">
                        {durationLabel(execucao.tempo_execucao_segundos)}
                      </TableCell>
                      <TableCell className="max-w-xs truncate text-sm text-muted-foreground">
                        {execucao.mensagem || "-"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>

        <Card className="self-start shadow-sm xl:sticky xl:top-24">
          <CardContent className="space-y-4 p-5">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-sm font-semibold">Painel da coleta</div>
                <div className="text-xs text-muted-foreground">
                  {workerHealth
                    ? `Worker ${workerHealth.running ? "ocupado" : "livre"}`
                    : "Worker sem resposta"}
                </div>
              </div>
              <Button
                size="icon"
                variant="outline"
                onClick={() => {
                  void refreshExecucoes();
                  void refreshWorkerHealth();
                }}
                disabled={healthLoading}
                title="Atualizar status"
              >
                {healthLoading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCw className="h-4 w-4" />
                )}
              </Button>
            </div>

            <div
              className={`rounded-md border p-4 ${
                workerBusy ? "border-primary/30 bg-primary/5" : "bg-muted/40"
              }`}
            >
              <div className="flex items-center gap-3">
                <div
                  className={`flex h-10 w-10 items-center justify-center rounded-full ${
                    workerBusy ? "bg-primary text-primary-foreground" : "bg-muted"
                  }`}
                >
                  {workerBusy ? (
                    <Loader2 className="h-5 w-5 animate-spin" />
                  ) : (
                    <Activity className="h-5 w-5" />
                  )}
                </div>
                <div>
                  <div className="font-medium">
                    {workerBusy ? "Coleta em andamento" : "Nenhuma coleta rodando"}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {panelExecution
                      ? formatDateTime(panelExecution.iniciado_em)
                      : "Aguardando primeira execucao"}
                  </div>
                </div>
              </div>
            </div>

            {panelExecution ? (
              <div className="space-y-3 text-sm">
                <div className="grid grid-cols-2 gap-2">
                  <div className="rounded-md border p-3">
                    <div className="text-xs text-muted-foreground">Status</div>
                    <div className="mt-1">{statusBadge(panelExecution.status)}</div>
                  </div>
                  <div className="rounded-md border p-3">
                    <div className="text-xs text-muted-foreground">Tempo</div>
                    <div className="mt-1 font-medium">{durationLabel(panelSeconds)}</div>
                  </div>
                  <div className="rounded-md border p-3">
                    <div className="text-xs text-muted-foreground">Processados</div>
                    <div className="mt-1 font-medium">{panelExecution.total_processados}</div>
                  </div>
                  <div className="rounded-md border p-3">
                    <div className="text-xs text-muted-foreground">Resultado</div>
                    <div className="mt-1 font-medium">
                      {panelExecution.total_sucesso}/{panelExecution.total_erro}
                    </div>
                  </div>
                </div>

                <div className="rounded-md border p-3">
                  <div className="text-xs text-muted-foreground">Mensagem</div>
                  <div className="mt-1 text-sm">{panelExecution.mensagem || "-"}</div>
                </div>
              </div>
            ) : (
              <div className="rounded-md border p-3 text-sm text-muted-foreground">
                Nenhuma execucao registrada ainda.
              </div>
            )}

            <div className="space-y-3 rounded-md border p-3 text-sm text-muted-foreground">
              <p>As coletas são iniciadas somente nos dias e horários definidos na agenda.</p>
              <Button asChild className="w-full" variant="outline">
                <Link to="/agenda-coletas">
                  <CalendarClock className="mr-1 h-4 w-4" /> Configurar agenda
                </Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
