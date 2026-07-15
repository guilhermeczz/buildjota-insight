import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  BarChart3,
  CalendarDays,
  Download,
  FileSpreadsheet,
  PackageSearch,
  X,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import type { DateRange } from "react-day-picker";
import { toast } from "sonner";
import PageHeader from "@/components/layout/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatBRL, formatPct, formatDateTime, toDateString } from "@/lib/format";
import { supabase } from "@/lib/supabase";

type Familia = {
  id: string;
  nome: string;
};

type Concorrente = {
  id: string;
  nome: string;
};

type Produto = {
  id: string;
  sku_interno: string;
  nome: string;
  familia_id: string | null;
  preco_atual: number;
  familias?: Familia | null;
};

type Mapeamento = {
  id: string;
  produto_id: string;
  concorrente_id: string;
  sku_concorrente: string;
  ultimo_preco: number | null;
  ultima_atualizacao: string | null;
  status_coleta: "sucesso" | "erro" | "pendente";
  produtos?: Produto | null;
  concorrentes?: Concorrente | null;
};

type Historico = {
  id: string;
  mapeamento_id: string;
  preco_construjota: number;
  preco_concorrente: number | null;
  diferenca_valor: number | null;
  diferenca_percentual: number | null;
  status: "sucesso" | "erro" | "pendente";
  mensagem_erro: string | null;
  coletado_em: string;
  mapeamentos_sku?: Mapeamento | null;
};

type Row = {
  id: string;
  produto: string;
  sku: string;
  concorrente: string;
  skuConcorrente: string;
  familia: string;
  familiaId: string | null;
  concorrenteId: string;
  precoCJ: number;
  precoConcorrente: number | null;
  dif: number | null;
  difPct: number | null;
  status: "sucesso" | "erro" | "pendente";
  ultimaAtualizacao: string | null;
};

type Periodo = "7" | "30" | "90" | "0" | "custom";

const emptyLabel = "—";

function startOfDay(date: Date) {
  const next = new Date(date);
  next.setHours(0, 0, 0, 0);
  return next;
}

function endOfDay(date: Date) {
  const next = new Date(date);
  next.setHours(23, 59, 59, 999);
  return next;
}

function formatDateLabel(date: Date) {
  return date.toLocaleDateString("pt-BR");
}

function isInsideDateFilter(value: string | null, periodo: Periodo, range: DateRange | undefined) {
  const normalized = toDateString(value);
  if (!normalized) return periodo === "0";

  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) return periodo === "0";

  if (periodo === "custom") {
    if (range?.from && date < startOfDay(range.from)) return false;
    if (range?.to && date > endOfDay(range.to)) return false;
    return true;
  }

  if (periodo !== "0") {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - Number(periodo));
    return date >= cutoff;
  }

  return true;
}

function dateRangeLabel(range: DateRange | undefined) {
  if (!range?.from && !range?.to) return "Selecionar intervalo";
  if (range.from && range.to) {
    return `${formatDateLabel(range.from)} até ${formatDateLabel(range.to)}`;
  }
  if (range.from) return `A partir de ${formatDateLabel(range.from)}`;
  return `Até ${formatDateLabel(range.to as Date)}`;
}

function buildRows(mapeamentos: Mapeamento[]): Row[] {
  return mapeamentos.map((m) => {
    const produto = m.produtos;
    const concorrente = m.concorrentes;
    const precoCJ = Number(produto?.preco_atual ?? 0);
    const precoConcorrente = m.ultimo_preco === null ? null : Number(m.ultimo_preco);
    const hasPrice = precoConcorrente !== null && precoConcorrente > 0;
    const dif = hasPrice ? precoCJ - precoConcorrente : null;
    const difPct = hasPrice ? (Number(dif) / precoConcorrente) * 100 : null;

    return {
      id: m.id,
      produto: produto?.nome ?? emptyLabel,
      sku: produto?.sku_interno ?? emptyLabel,
      concorrente: concorrente?.nome ?? emptyLabel,
      skuConcorrente: m.sku_concorrente,
      familia: produto?.familias?.nome ?? "Sem família",
      familiaId: produto?.familia_id ?? null,
      concorrenteId: m.concorrente_id,
      precoCJ,
      precoConcorrente,
      dif,
      difPct,
      status: m.status_coleta,
      ultimaAtualizacao: m.ultima_atualizacao,
    };
  });
}

function downloadCSV(rows: Row[], filename: string) {
  const header = [
    "Produto",
    "SKU CJ",
    "Concorrente",
    "Cód. Conc.",
    "Família",
    "Preço CJ",
    "Preço Conc.",
    "Diferença R$",
    "Diferença %",
    "Status",
    "Última coleta",
  ];
  const csv = [
    header.join(";"),
    ...rows.map((r) =>
      [
        r.produto,
        r.sku,
        r.concorrente,
        r.skuConcorrente,
        r.familia,
        r.precoCJ.toFixed(2),
        r.precoConcorrente === null ? "" : r.precoConcorrente.toFixed(2),
        r.dif === null ? "" : r.dif.toFixed(2),
        r.difPct === null ? "" : r.difPct.toFixed(2),
        r.status,
        r.ultimaAtualizacao ? formatDateTime(r.ultimaAtualizacao) : "",
      ].join(";"),
    ),
  ].join("\n");
  const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
  toast.success("Exportação concluída.");
}

function RelatorioTable({
  rows,
  title,
  filename,
}: {
  rows: Row[];
  title: string;
  filename: string;
}) {
  return (
    <Card className="shadow-sm">
      <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <CardTitle className="text-base">{title}</CardTitle>
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={rows.length === 0}
            onClick={() => downloadCSV(rows, `${filename}.csv`)}
          >
            <Download className="mr-1 h-4 w-4" /> CSV
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={rows.length === 0}
            onClick={() => downloadCSV(rows, `${filename}.xls`)}
          >
            <FileSpreadsheet className="mr-1 h-4 w-4" /> Excel
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Produto</TableHead>
                <TableHead>SKU CJ</TableHead>
                <TableHead>Concorrente</TableHead>
                <TableHead>Cód. Conc.</TableHead>
                <TableHead>Família</TableHead>
                <TableHead>Preço CJ</TableHead>
                <TableHead>Preço Conc.</TableHead>
                <TableHead>Diferença</TableHead>
                <TableHead>%</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Última coleta</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={11} className="py-10 text-center text-muted-foreground">
                    Sem dados para os filtros selecionados.
                  </TableCell>
                </TableRow>
              )}
              {rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-medium">{r.produto}</TableCell>
                  <TableCell className="font-mono text-xs">{r.sku}</TableCell>
                  <TableCell>{r.concorrente}</TableCell>
                  <TableCell className="font-mono text-xs">{r.skuConcorrente}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{r.familia}</TableCell>
                  <TableCell>{formatBRL(r.precoCJ)}</TableCell>
                  <TableCell>
                    {r.precoConcorrente !== null && r.precoConcorrente > 0
                      ? formatBRL(r.precoConcorrente)
                      : emptyLabel}
                  </TableCell>
                  <TableCell
                    className={
                      Number(r.dif) > 0
                        ? "font-medium text-destructive"
                        : Number(r.dif) < 0
                          ? "font-medium text-success"
                          : ""
                    }
                  >
                    {r.precoConcorrente !== null && r.precoConcorrente > 0 && r.dif !== null
                      ? `${r.dif > 0 ? "+" : ""}${formatBRL(r.dif)}`
                      : emptyLabel}
                  </TableCell>
                  <TableCell
                    className={
                      Number(r.difPct) > 0
                        ? "font-medium text-destructive"
                        : Number(r.difPct) < 0
                          ? "font-medium text-success"
                          : ""
                    }
                  >
                    {r.precoConcorrente !== null && r.precoConcorrente > 0 && r.difPct !== null
                      ? formatPct(r.difPct)
                      : emptyLabel}
                  </TableCell>
                  <TableCell>
                    {r.status === "sucesso" && (
                      <Badge className="bg-success text-success-foreground">Sucesso</Badge>
                    )}
                    {r.status === "erro" && <Badge variant="destructive">Erro</Badge>}
                    {r.status === "pendente" && <Badge variant="secondary">Pendente</Badge>}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                    {r.ultimaAtualizacao ? formatDateTime(r.ultimaAtualizacao) : emptyLabel}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}

function KpiCard({
  icon: Icon,
  label,
  value,
  sub,
  valueClass,
}: {
  icon: typeof BarChart3;
  label: string;
  value: string | number;
  sub: string;
  valueClass?: string;
}) {
  return (
    <Card className="shadow-sm">
      <CardContent className="p-5">
        <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-primary/15 text-primary">
          <Icon className="h-5 w-5" />
        </div>
        <div className="text-xs font-medium text-muted-foreground">{label}</div>
        <div className={`mt-2 text-2xl font-bold ${valueClass ?? ""}`}>{value}</div>
        <div className="mt-1 text-xs text-muted-foreground">{sub}</div>
      </CardContent>
    </Card>
  );
}

export default function Relatorios() {
  const [familiaFilter, setFamiliaFilter] = useState("todas");
  const [concorrenteFilter, setConcorrenteFilter] = useState("todos");
  const [periodo, setPeriodo] = useState<Periodo>("30");
  const [dateRange, setDateRange] = useState<DateRange | undefined>();
  const [familias, setFamilias] = useState<Familia[]>([]);
  const [concorrentes, setConcorrentes] = useState<Concorrente[]>([]);
  const [mapeamentos, setMapeamentos] = useState<Mapeamento[]>([]);
  const [historico, setHistorico] = useState<Historico[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;

    async function loadReports() {
      setLoading(true);
      const [familiasResult, concorrentesResult, mapeamentosResult, historicoResult] =
        await Promise.all([
          supabase.from("familias").select("id,nome").order("nome"),
          supabase.from("concorrentes").select("id,nome").order("nome"),
          supabase
            .from("mapeamentos_sku")
            .select(
              "id,produto_id,concorrente_id,sku_concorrente,ultimo_preco,ultima_atualizacao,status_coleta,produtos(id,sku_interno,nome,familia_id,preco_atual,familias(id,nome)),concorrentes(id,nome)",
            )
            .order("ultima_atualizacao", { ascending: false, nullsFirst: false }),
          supabase
            .from("historico_precos")
            .select(
              "id,mapeamento_id,preco_construjota,preco_concorrente,diferenca_valor,diferenca_percentual,status,mensagem_erro,coletado_em,mapeamentos_sku(id,produto_id,concorrente_id,sku_concorrente,produtos(id,sku_interno,nome,familia_id,preco_atual,familias(id,nome)),concorrentes(id,nome))",
            )
            .order("coletado_em", { ascending: false })
            .limit(500),
        ]);

      if (!mounted) return;

      const hasError =
        familiasResult.error ||
        concorrentesResult.error ||
        mapeamentosResult.error ||
        historicoResult.error;

      if (hasError) {
        toast.error("Não foi possível carregar os relatórios.");
      }

      setFamilias((familiasResult.data ?? []) as Familia[]);
      setConcorrentes((concorrentesResult.data ?? []) as Concorrente[]);
      setMapeamentos(
        ((mapeamentosResult.data ?? []) as Mapeamento[]).map((mapeamento) => ({
          ...mapeamento,
          ultimo_preco: mapeamento.ultimo_preco === null ? null : Number(mapeamento.ultimo_preco),
          ultima_atualizacao: toDateString(mapeamento.ultima_atualizacao),
          produtos: mapeamento.produtos
            ? {
                ...mapeamento.produtos,
                preco_atual: Number(mapeamento.produtos.preco_atual ?? 0),
              }
            : null,
        })),
      );
      setHistorico(
        ((historicoResult.data ?? []) as Historico[]).map((row) => ({
          ...row,
          preco_construjota: Number(row.preco_construjota ?? 0),
          preco_concorrente: row.preco_concorrente === null ? null : Number(row.preco_concorrente),
          diferenca_valor: row.diferenca_valor === null ? null : Number(row.diferenca_valor),
          diferenca_percentual:
            row.diferenca_percentual === null ? null : Number(row.diferenca_percentual),
          coletado_em: toDateString(row.coletado_em),
        })),
      );
      setLoading(false);
    }

    loadReports();

    return () => {
      mounted = false;
    };
  }, []);

  const baseRows = useMemo(() => buildRows(mapeamentos), [mapeamentos]);

  const filteredRows = useMemo(() => {
    return baseRows.filter((r) => {
      if (familiaFilter !== "todas" && r.familiaId !== familiaFilter) return false;
      if (concorrenteFilter !== "todos" && r.concorrenteId !== concorrenteFilter) return false;
      return isInsideDateFilter(r.ultimaAtualizacao, periodo, dateRange);
    });
  }, [baseRows, concorrenteFilter, dateRange, familiaFilter, periodo]);

  const acima = filteredRows.filter(
    (r) => r.precoConcorrente !== null && r.precoConcorrente > 0 && Number(r.dif) > 0,
  );
  const abaixo = filteredRows.filter(
    (r) => r.precoConcorrente !== null && r.precoConcorrente > 0 && Number(r.dif) < 0,
  );
  const erros = historico.filter((h) => {
    const mapeamento = h.mapeamentos_sku;
    if (h.status !== "erro") return false;
    if (familiaFilter !== "todas" && mapeamento?.produtos?.familia_id !== familiaFilter) {
      return false;
    }
    if (concorrenteFilter !== "todos" && mapeamento?.concorrente_id !== concorrenteFilter) {
      return false;
    }
    return isInsideDateFilter(h.coletado_em, periodo, dateRange);
  });

  const porFamilia = Object.entries(
    filteredRows.reduce<Record<string, Row[]>>(
      (acc, r) => ((acc[r.familia] ||= []).push(r), acc),
      {},
    ),
  );
  const porConcorrente = Object.entries(
    filteredRows.reduce<Record<string, Row[]>>(
      (acc, r) => ((acc[r.concorrente] ||= []).push(r), acc),
      {},
    ),
  );

  const withPrice = filteredRows.filter(
    (r) => r.precoConcorrente !== null && r.precoConcorrente > 0,
  );
  const mediaPct = withPrice.reduce((acc, r) => acc + r.difPct, 0) / Math.max(withPrice.length, 1);

  return (
    <>
      <PageHeader
        title="Relatórios"
        description="Análise gerencial de preços, concorrentes e coletas."
      />

      <div className="mb-4 grid grid-cols-1 gap-4 md:grid-cols-4">
        <KpiCard
          icon={PackageSearch}
          label="Mapeamentos"
          value={filteredRows.length}
          sub="Itens analisados"
        />
        <KpiCard
          icon={TrendingUp}
          label="Acima do concorrente"
          value={acima.length}
          sub="Preço CJ maior"
          valueClass="text-destructive"
        />
        <KpiCard
          icon={TrendingDown}
          label="Abaixo do concorrente"
          value={abaixo.length}
          sub="Preço CJ menor"
          valueClass="text-success"
        />
        <KpiCard
          icon={BarChart3}
          label="Diferença média"
          value={`${mediaPct.toFixed(2).replace(".", ",")}%`}
          sub="Base filtrada"
        />
      </div>

      <Card className="mb-4 shadow-sm">
        <CardHeader>
          <CardTitle className="text-base">Filtros</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
          <Select value={familiaFilter} onValueChange={setFamiliaFilter}>
            <SelectTrigger>
              <SelectValue placeholder="Família" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="todas">Todas as famílias</SelectItem>
              {familias.map((f) => (
                <SelectItem key={f.id} value={f.id}>
                  {f.nome}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={concorrenteFilter} onValueChange={setConcorrenteFilter}>
            <SelectTrigger>
              <SelectValue placeholder="Concorrente" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todos os concorrentes</SelectItem>
              {concorrentes.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.nome}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={periodo}
            onValueChange={(value: Periodo) => {
              setPeriodo(value);
              if (value !== "custom") setDateRange(undefined);
            }}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="7">Últimos 7 dias</SelectItem>
              <SelectItem value="30">Últimos 30 dias</SelectItem>
              <SelectItem value="90">Últimos 90 dias</SelectItem>
              <SelectItem value="custom">Escolher datas</SelectItem>
              <SelectItem value="0">Todo o período</SelectItem>
            </SelectContent>
          </Select>
          <div className="flex gap-2">
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  className="w-full justify-start gap-2 font-normal"
                  onClick={() => setPeriodo("custom")}
                >
                  <CalendarDays className="h-4 w-4" />
                  <span className="truncate">{dateRangeLabel(dateRange)}</span>
                </Button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-auto p-0">
                <Calendar
                  mode="range"
                  selected={dateRange}
                  onSelect={(range) => {
                    setDateRange(range);
                    setPeriodo("custom");
                  }}
                  numberOfMonths={2}
                  captionLayout="dropdown"
                />
              </PopoverContent>
            </Popover>
            {(dateRange?.from || dateRange?.to) && (
              <Button
                type="button"
                variant="outline"
                size="icon"
                onClick={() => setDateRange(undefined)}
                aria-label="Limpar intervalo de datas"
              >
                <X className="h-4 w-4" />
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {loading ? (
        <Card className="shadow-sm">
          <CardContent className="py-12 text-center text-muted-foreground">
            Carregando relatórios...
          </CardContent>
        </Card>
      ) : mapeamentos.length === 0 ? (
        <Card className="border-primary/40 bg-primary/5 shadow-sm">
          <CardContent className="flex gap-3 p-5 text-sm">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
            <div>
              <div className="font-medium">Ainda não há mapeamentos para gerar relatórios.</div>
              <div className="mt-1 text-muted-foreground">
                Os filtros já carregam famílias e concorrentes cadastrados. Cadastre produtos e
                mapeamentos de SKU para ver comparações, variações e exportações.
              </div>
            </div>
          </CardContent>
        </Card>
      ) : (
        <Tabs defaultValue="atual" className="space-y-4">
          <TabsList className="h-auto flex-wrap">
            <TabsTrigger value="atual">Comparação atual</TabsTrigger>
            <TabsTrigger value="acima">Acima</TabsTrigger>
            <TabsTrigger value="abaixo">Abaixo</TabsTrigger>
            <TabsTrigger value="familia">Por família</TabsTrigger>
            <TabsTrigger value="concorrente">Por concorrente</TabsTrigger>
            <TabsTrigger value="erros">Erros</TabsTrigger>
          </TabsList>

          <TabsContent value="atual">
            <RelatorioTable
              rows={filteredRows}
              title="Comparação atual ConstruJota x Concorrentes"
              filename="comparacao-atual"
            />
          </TabsContent>
          <TabsContent value="acima">
            <RelatorioTable
              rows={acima}
              title="Produtos acima do concorrente"
              filename="acima-concorrente"
            />
          </TabsContent>
          <TabsContent value="abaixo">
            <RelatorioTable
              rows={abaixo}
              title="Produtos abaixo do concorrente"
              filename="abaixo-concorrente"
            />
          </TabsContent>
          <TabsContent value="familia" className="space-y-4">
            {porFamilia.length === 0 && (
              <RelatorioTable rows={[]} title="Por família" filename="por-familia" />
            )}
            {porFamilia.map(([nome, rows]) => (
              <RelatorioTable
                key={nome}
                rows={rows}
                title={`Família: ${nome}`}
                filename={`familia-${nome}`}
              />
            ))}
          </TabsContent>
          <TabsContent value="concorrente" className="space-y-4">
            {porConcorrente.length === 0 && (
              <RelatorioTable rows={[]} title="Por concorrente" filename="por-concorrente" />
            )}
            {porConcorrente.map(([nome, rows]) => (
              <RelatorioTable
                key={nome}
                rows={rows}
                title={`Concorrente: ${nome}`}
                filename={`concorrente-${nome}`}
              />
            ))}
          </TabsContent>
          <TabsContent value="erros">
            <Card className="shadow-sm">
              <CardHeader>
                <CardTitle className="text-base">Erros de coleta</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Data</TableHead>
                        <TableHead>Produto</TableHead>
                        <TableHead>Concorrente</TableHead>
                        <TableHead>Mensagem</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {erros.length === 0 && (
                        <TableRow>
                          <TableCell
                            colSpan={4}
                            className="py-10 text-center text-muted-foreground"
                          >
                            Nenhum erro registrado.
                          </TableCell>
                        </TableRow>
                      )}
                      {erros.map((erro) => (
                        <TableRow key={erro.id}>
                          <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                            {formatDateTime(erro.coletado_em)}
                          </TableCell>
                          <TableCell className="font-medium">
                            {erro.mapeamentos_sku?.produtos?.nome ?? emptyLabel}
                          </TableCell>
                          <TableCell>
                            {erro.mapeamentos_sku?.concorrentes?.nome ?? emptyLabel}
                          </TableCell>
                          <TableCell>
                            <Badge variant="destructive" className="mr-2">
                              Erro
                            </Badge>
                            {erro.mensagem_erro ?? "Sem mensagem"}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      )}
    </>
  );
}
