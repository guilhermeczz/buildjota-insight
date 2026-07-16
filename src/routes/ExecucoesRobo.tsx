import { useCallback, useEffect, useState } from "react";
import PageHeader from "@/components/layout/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { compareProductNames, sortByProductName } from "@/lib/product-sort";
import { apiClient } from "@/lib/api-client";
import { Activity, Loader2, Play, RefreshCw, RotateCcw } from "lucide-react";
import { toast } from "sonner";

const WORKER_REQUEST_TIMEOUT_MS = 12000;
const WORKER_HEALTH_INTERVAL_MS = 5000;

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

type Produto = {
  id: string;
  nome: string;
  sku_interno: string;
  familia_id: string | null;
};

type Mapeamento = {
  id: string;
  sku_concorrente: string;
  produtos?: {
    nome: string;
    sku_interno: string;
  } | null;
  concorrentes?: {
    nome: string;
  } | null;
};

type HistoricoExecucao = {
  coletado_em: string;
  mapeamentos_sku?: {
    produtos?: {
      familia_id: string | null;
    } | null;
  } | null;
};

type Scope = "" | "todos" | "familia" | "produto" | "mapeamento";
type StatusFilter = "todos" | Execucao["status"];

type WorkerRun = {
  id: string;
  kind: "manual" | "refazer-erros" | "agendado" | string;
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

async function requestWorkerRun(triggerUrl: string, body: Record<string, unknown>) {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), WORKER_REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(triggerUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    const result = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(result.error ?? "Falha ao executar a coleta");
    }

    return result;
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error(
        "O servidor do worker nao respondeu. Verifique se npm run worker:server esta rodando.",
      );
    }

    throw error;
  } finally {
    window.clearTimeout(timeoutId);
  }
}

function workerHealthUrl(triggerUrl: string) {
  return triggerUrl.replace(/\/run\/?$/, "/health");
}

async function requestWorkerHealth(triggerUrl: string) {
  const response = await fetch(workerHealthUrl(triggerUrl), { method: "GET" });
  if (!response.ok) throw new Error("Worker indisponivel");
  return (await response.json()) as WorkerHealth;
}

export default function ExecucoesRobo() {
  const [execucoes, setExecucoes] = useState<Execucao[]>([]);
  const [familias, setFamilias] = useState<Familia[]>([]);
  const [produtos, setProdutos] = useState<Produto[]>([]);
  const [mapeamentos, setMapeamentos] = useState<Mapeamento[]>([]);
  const [historicosExecucao, setHistoricosExecucao] = useState<HistoricoExecucao[]>([]);
  const [pendingExecucao, setPendingExecucao] = useState<Execucao | null>(null);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("todos");
  const [familiaFilter, setFamiliaFilter] = useState("todos");
  const [manualOpen, setManualOpen] = useState(false);
  const [scope, setScope] = useState<Scope>("");
  const [familiaId, setFamiliaId] = useState("");
  const [produtoId, setProdutoId] = useState("");
  const [mapeamentoId, setMapeamentoId] = useState("");
  const [retryingErrors, setRetryingErrors] = useState(false);
  const [running, setRunning] = useState(false);
  const [workerHealth, setWorkerHealth] = useState<WorkerHealth | null>(null);
  const [healthLoading, setHealthLoading] = useState(false);

  const triggerUrl = import.meta.env.VITE_WORKER_TRIGGER_URL ?? "http://localhost:8787/run";

  const refreshWorkerHealth = useCallback(async () => {
    setHealthLoading(true);
    try {
      setWorkerHealth(await requestWorkerHealth(triggerUrl));
    } catch {
      setWorkerHealth(null);
    } finally {
      setHealthLoading(false);
    }
  }, [triggerUrl]);

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
    setPendingExecucao((current) => {
      if (!current) return null;
      const currentStartedAt = toTimestamp(current.iniciado_em);
      const hasRealExecution = nextExecucoes.some(
        (execucao) => toTimestamp(execucao.iniciado_em) >= currentStartedAt,
      );
      return hasRealExecution ? null : current;
    });
    setLoading(false);
  }

  useEffect(() => {
    void refreshExecucoes();
    void loadManualOptions();
    void refreshWorkerHealth();
  }, [refreshWorkerHealth]);

  useEffect(() => {
    const hasPendingExecution =
      pendingExecucao !== null ||
      workerHealth?.running === true ||
      execucoes.some((execucao) => execucao.status === "pendente" || !execucao.finalizado_em);

    const interval = window.setInterval(
      () => {
        void refreshExecucoes();
      },
      hasPendingExecution ? 5000 : 60000,
    );

    return () => window.clearInterval(interval);
  }, [execucoes, pendingExecucao, workerHealth?.running]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") void refreshWorkerHealth();
    }, WORKER_HEALTH_INTERVAL_MS);

    return () => window.clearInterval(interval);
  }, [refreshWorkerHealth]);

  async function loadManualOptions() {
    const [familiasResult, produtosResult, mapeamentosResult] = await Promise.all([
      apiClient.from("familias").select("id,nome").eq("ativo", true).order("nome"),
      apiClient
        .from("produtos")
        .select("id,nome,sku_interno,familia_id")
        .eq("ativo", true)
        .order("nome"),
      apiClient
        .from("mapeamentos_sku")
        .select("id,sku_concorrente,produtos(nome,sku_interno),concorrentes(nome)")
        .eq("ativo", true)
        .order("created_at", { ascending: true }),
    ]);

    if (familiasResult.error || produtosResult.error || mapeamentosResult.error) {
      toast.error("Não foi possível carregar os filtros de execução manual");
      return;
    }

    setFamilias((familiasResult.data ?? []) as Familia[]);
    setProdutos(
      sortByProductName((produtosResult.data ?? []) as Produto[], (produto) => produto.nome),
    );
    setMapeamentos(
      ((mapeamentosResult.data ?? []) as Mapeamento[]).sort((a, b) => {
        const productCompare = compareProductNames(a.produtos?.nome ?? "", b.produtos?.nome ?? "");
        if (productCompare !== 0) return productCompare;
        return (a.concorrentes?.nome ?? "").localeCompare(b.concorrentes?.nome ?? "", "pt-BR");
      }),
    );
  }

  function openManualDialog() {
    setScope("");
    setFamiliaId("");
    setProdutoId("");
    setMapeamentoId("");
    setManualOpen(true);
  }

  async function runManualCollection() {
    if (!scope) {
      toast.error("Selecione como deseja executar a coleta");
      return;
    }

    if (scope === "familia" && !familiaId) {
      toast.error("Selecione uma família");
      return;
    }

    if (scope === "produto" && !produtoId) {
      toast.error("Selecione um produto");
      return;
    }

    if (scope === "mapeamento" && !mapeamentoId) {
      toast.error("Selecione um mapeamento");
      return;
    }

    const body =
      scope === "familia"
        ? { familiaId }
        : scope === "produto"
          ? { produtoId }
          : scope === "mapeamento"
            ? { mapeamentoId }
            : {};

    setRunning(true);

    try {
      const result = await requestWorkerRun(triggerUrl, body);
      const currentRun = result.currentRun as WorkerRun | undefined;

      const startedAt = currentRun?.startedAt ?? new Date().toISOString();
      setPendingExecucao({
        id: currentRun?.id ?? `manual-${Date.now()}`,
        status: "pendente",
        origem: "manual",
        iniciado_em: startedAt,
        finalizado_em: null,
        total_processados: 0,
        total_sucesso: 0,
        total_erro: 0,
        mensagem: "Buscando preços nos concorrentes...",
        tempo_execucao_segundos: 0,
      });
      toast.success("Coleta manual iniciada");
      setManualOpen(false);
      await refreshExecucoes();
      await refreshWorkerHealth();
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Não foi possível chamar o worker. Verifique se npm run worker:server está rodando.",
      );
    } finally {
      setRunning(false);
    }
  }

  async function retryFailedMappings(execucao?: Execucao) {
    setRetryingErrors(true);

    try {
      const body: Record<string, unknown> = { failedOnly: true };
      if (execucao) {
        body.failedSince = execucao.iniciado_em;
        body.failedUntil = execucao.finalizado_em ?? new Date().toISOString();
      }

      const result = await requestWorkerRun(triggerUrl, body);
      const currentRun = result.currentRun as WorkerRun | undefined;

      setPendingExecucao({
        id: currentRun?.id ?? `retry-${Date.now()}`,
        status: "pendente",
        origem: "manual",
        iniciado_em: currentRun?.startedAt ?? new Date().toISOString(),
        finalizado_em: null,
        total_processados: 0,
        total_sucesso: 0,
        total_erro: 0,
        mensagem: "Refazendo coletas com erro...",
        tempo_execucao_segundos: 0,
      });
      toast.success("Reprocessamento dos erros iniciado");
      await refreshExecucoes();
      await refreshWorkerHealth();
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Não foi possível chamar o worker. Verifique se npm run worker:server está rodando.",
      );
    } finally {
      setRetryingErrors(false);
    }
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

  function isRetryExecution(execucao: Execucao) {
    return /filtro:\s*erros|refazendo coletas com erro/i.test(execucao.mensagem);
  }

  const latestRetryAt = execucoes.filter(isRetryExecution).reduce((latest, execucao) => {
    const startedAt = toTimestamp(execucao.iniciado_em);
    return Math.max(latest, startedAt);
  }, 0);

  function retryAlreadyRequested(execucao: Execucao) {
    if (!latestRetryAt) return false;
    return toTimestamp(execucao.iniciado_em) <= latestRetryAt;
  }

  const dbCurrentExecution =
    execucoes.find((execucao) => execucao.status === "pendente" || !execucao.finalizado_em) ?? null;
  const healthExecution =
    workerHealth?.running && workerHealth.currentRun
      ? ({
          id: workerHealth.currentRun.id,
          status: "pendente",
          origem: workerHealth.currentRun.kind === "agendado" ? "agendado" : "manual",
          iniciado_em: toDateString(workerHealth.currentRun.startedAt),
          finalizado_em: null,
          total_processados: 0,
          total_sucesso: 0,
          total_erro: 0,
          mensagem: workerHealth.currentRun.message ?? "Coleta em andamento...",
          tempo_execucao_segundos: 0,
        } satisfies Execucao)
      : null;
  const syntheticExecution = pendingExecucao ?? (!dbCurrentExecution ? healthExecution : null);
  const currentExecution = pendingExecucao ?? dbCurrentExecution ?? healthExecution ?? null;
  const latestFailedExecution =
    execucoes.find((execucao) => execucao.status === "erro" || execucao.status === "parcial") ??
    null;
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
        description="Histórico das execuções registradas pelo worker de coleta de preços."
        actions={
          <Button
            onClick={openManualDialog}
            disabled={workerBusy || running || retryingErrors}
            className="bg-primary text-primary-foreground hover:bg-primary/90"
          >
            <Play className="mr-1 h-4 w-4" /> Executar coleta manual
          </Button>
        }
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
                    <TableHead className="text-right">Ações</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loading && (
                    <TableRow>
                      <TableCell colSpan={10} className="py-10 text-center text-muted-foreground">
                        Carregando execuções...
                      </TableCell>
                    </TableRow>
                  )}
                  {!loading && visibleExecucoes.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={10} className="py-10 text-center text-muted-foreground">
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
                      <TableCell className="text-right">
                        {(execucao.status === "erro" || execucao.status === "parcial") && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => retryFailedMappings(execucao)}
                            disabled={
                              workerBusy || retryingErrors || retryAlreadyRequested(execucao)
                            }
                          >
                            <RotateCcw className="mr-1 h-4 w-4" />
                            {retryAlreadyRequested(execucao) ? "Já refeito" : "Refazer erros"}
                          </Button>
                        )}
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

            <div className="space-y-2">
              <Button
                className="w-full"
                onClick={openManualDialog}
                disabled={workerBusy || running || retryingErrors}
              >
                <Play className="mr-1 h-4 w-4" /> Nova coleta manual
              </Button>
              <Button
                className="w-full"
                variant="outline"
                onClick={() => retryFailedMappings(latestFailedExecution ?? undefined)}
                disabled={workerBusy || retryingErrors || !latestFailedExecution}
              >
                {retryingErrors ? (
                  <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                ) : (
                  <RotateCcw className="mr-1 h-4 w-4" />
                )}
                Refazer erros
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>

      <Dialog open={manualOpen} onOpenChange={setManualOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Executar coleta manual</DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>Escopo da coleta</Label>
              <select
                value={scope}
                onChange={(event) => {
                  setScope(event.target.value as Scope);
                  setFamiliaId("");
                  setProdutoId("");
                  setMapeamentoId("");
                }}
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm outline-none transition-colors focus:ring-1 focus:ring-ring"
              >
                <option value="" disabled>
                  Selecione uma opcao
                </option>
                <option value="todos">Todos os produtos</option>
                <option value="familia">Uma família</option>
                <option value="produto">Um produto específico</option>
                <option value="mapeamento">Um mapeamento específico</option>
              </select>
            </div>

            {scope === "familia" && (
              <div className="space-y-1.5">
                <Label>Família</Label>
                <select
                  value={familiaId}
                  onChange={(event) => setFamiliaId(event.target.value)}
                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm outline-none transition-colors focus:ring-1 focus:ring-ring"
                >
                  <option value="" disabled>
                    Selecione uma família
                  </option>
                  {familias.map((familia) => (
                    <option key={familia.id} value={familia.id}>
                      {familia.nome}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {scope === "produto" && (
              <div className="space-y-1.5">
                <Label>Produto</Label>
                <select
                  value={produtoId}
                  onChange={(event) => setProdutoId(event.target.value)}
                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm outline-none transition-colors focus:ring-1 focus:ring-ring"
                >
                  <option value="" disabled>
                    Selecione um produto
                  </option>
                  {produtos.map((produto) => (
                    <option key={produto.id} value={produto.id}>
                      {produto.sku_interno} - {produto.nome}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {scope === "mapeamento" && (
              <div className="space-y-1.5">
                <Label>Mapeamento</Label>
                <select
                  value={mapeamentoId}
                  onChange={(event) => setMapeamentoId(event.target.value)}
                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm outline-none transition-colors focus:ring-1 focus:ring-ring"
                >
                  <option value="" disabled>
                    Selecione um mapeamento
                  </option>
                  {mapeamentos.map((mapeamento) => (
                    <option key={mapeamento.id} value={mapeamento.id}>
                      {mapeamento.produtos?.sku_interno ?? "-"} -{" "}
                      {mapeamento.produtos?.nome ?? "Produto"} /{" "}
                      {mapeamento.concorrentes?.nome ?? "Concorrente"} -{" "}
                      {mapeamento.sku_concorrente}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setManualOpen(false)} disabled={running}>
              Cancelar
            </Button>
            <Button onClick={runManualCollection} disabled={running}>
              {running && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
              {running ? "Iniciando..." : "Executar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
