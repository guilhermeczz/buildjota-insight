import { useEffect, useMemo, useState } from "react";
import PageHeader from "@/components/layout/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
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
import { formatBRL, formatDateTime, formatPct, toDateString, toTimestamp } from "@/lib/format";
import { compareProductNames, sortByProductName } from "@/lib/product-sort";
import { apiClient } from "@/lib/api-client";
import {
  ArrowDownRight,
  ArrowDownAZ,
  ArrowRight,
  ArrowUpRight,
  ChevronDown,
  Minus,
  RotateCcw,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import { toast } from "sonner";

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
  familias?: Familia | null;
};

type Mapeamento = {
  id: string;
  sku_concorrente: string;
  produto_id: string;
  concorrente_id: string;
  produtos?: Produto | null;
  concorrentes?: Concorrente | null;
};

type Historico = {
  id: string;
  mapeamento_id: string;
  preco_concorrente: number | null;
  status: "sucesso" | "erro" | "pendente";
  coletado_em: string;
  mapeamentos_sku?: Mapeamento | null;
};

type Trend = "subiu" | "caiu" | "estavel" | "sem-comparacao";

type MonitorRow = {
  id: string;
  produto: Produto | null;
  concorrente: Concorrente | null;
  codigoConcorrente: string;
  precoAtual: number;
  precoAnterior: number | null;
  variacao: number;
  variacaoPct: number;
  trend: Trend;
  ultimaColeta: string;
  historico: Historico[];
};

const trendLabels: Record<Trend, string> = {
  subiu: "Subiu",
  caiu: "Caiu",
  estavel: "Estável",
  "sem-comparacao": "Sem comparação",
};

function numeric(value: number | null | undefined) {
  return Number(value ?? 0);
}

function trendBadge(trend: Trend) {
  if (trend === "subiu") {
    return <Badge variant="destructive">Subiu</Badge>;
  }

  if (trend === "caiu") {
    return <Badge className="bg-success text-success-foreground">Caiu</Badge>;
  }

  if (trend === "estavel") {
    return <Badge variant="outline">Estável</Badge>;
  }

  return <Badge variant="secondary">Sem comparação</Badge>;
}

function trendIcon(trend: Trend) {
  if (trend === "subiu") return <ArrowUpRight className="h-4 w-4 text-destructive" />;
  if (trend === "caiu") return <ArrowDownRight className="h-4 w-4 text-success" />;
  if (trend === "estavel") return <ArrowRight className="h-4 w-4 text-muted-foreground" />;
  return <Minus className="h-4 w-4 text-muted-foreground" />;
}

export default function MonitoramentoPrecos() {
  const [familias, setFamilias] = useState<Familia[]>([]);
  const [concorrentes, setConcorrentes] = useState<Concorrente[]>([]);
  const [historico, setHistorico] = useState<Historico[]>([]);
  const [familiaFilter, setFamiliaFilter] = useState("todas");
  const [selectedProductIds, setSelectedProductIds] = useState<string[]>([]);
  const [productOrder, setProductOrder] = useState<"az" | "za">("az");
  const [concorrenteFilter, setConcorrenteFilter] = useState("todos");
  const [trendFilter, setTrendFilter] = useState("todos");
  const [loading, setLoading] = useState(true);

  async function refreshData() {
    const [familiasResult, concorrentesResult, historicoResult] = await Promise.all([
      apiClient.from("familias").select("id,nome").eq("ativo", true).order("nome"),
      apiClient.from("concorrentes").select("id,nome").eq("ativo", true).order("nome"),
      apiClient
        .from("historico_precos")
        .select(
          "id,mapeamento_id,preco_concorrente,status,coletado_em,mapeamentos_sku(id,sku_concorrente,produto_id,concorrente_id,produtos(id,sku_interno,nome,familia_id,familias(id,nome)),concorrentes(id,nome))",
        )
        .eq("status", "sucesso")
        .order("coletado_em", { ascending: false })
        .limit(800),
    ]);

    if (familiasResult.error || concorrentesResult.error || historicoResult.error) {
      toast.error("Não foi possível carregar o monitoramento de preços");
      setLoading(false);
      return;
    }

    setFamilias((familiasResult.data ?? []) as Familia[]);
    setConcorrentes((concorrentesResult.data ?? []) as Concorrente[]);
    setHistorico(
      ((historicoResult.data ?? []) as Historico[]).map((row) => ({
        ...row,
        preco_concorrente: row.preco_concorrente === null ? null : numeric(row.preco_concorrente),
        coletado_em: toDateString(row.coletado_em),
      })),
    );
    setLoading(false);
  }

  useEffect(() => {
    void refreshData();
  }, []);

  const rows = useMemo(() => {
    const groups = new Map<string, Historico[]>();

    for (const item of historico) {
      if (!item.mapeamentos_sku) continue;
      const current = groups.get(item.mapeamento_id) ?? [];
      current.push(item);
      groups.set(item.mapeamento_id, current);
    }

    return Array.from(groups.entries())
      .map(([id, items]) => {
        const sorted = [...items].sort(
          (a, b) => toTimestamp(b.coletado_em) - toTimestamp(a.coletado_em),
        );
        const current = sorted[0];
        const previous = sorted.slice(1).find((item) => item.preco_concorrente !== null);
        const mapeamento = current.mapeamentos_sku;
        if (current.preco_concorrente === null) return null;

        const precoAtual = numeric(current.preco_concorrente);
        const precoAnterior = previous ? numeric(previous.preco_concorrente) : null;
        const variacao = precoAnterior === null ? 0 : precoAtual - precoAnterior;
        const variacaoPct =
          precoAnterior && precoAnterior > 0 ? (variacao / precoAnterior) * 100 : 0;
        const trend: Trend =
          precoAnterior === null
            ? "sem-comparacao"
            : Math.abs(variacao) < 0.001
              ? "estavel"
              : variacao > 0
                ? "subiu"
                : "caiu";

        return {
          id,
          produto: mapeamento?.produtos ?? null,
          concorrente: mapeamento?.concorrentes ?? null,
          codigoConcorrente: mapeamento?.sku_concorrente ?? "",
          precoAtual,
          precoAnterior,
          variacao,
          variacaoPct,
          trend,
          ultimaColeta: current.coletado_em,
          historico: sorted.slice(0, 5),
        };
      })
      .filter((row): row is MonitorRow => row !== null)
      .sort((a, b) => {
        const trendPriority = { subiu: 0, caiu: 1, estavel: 2, "sem-comparacao": 3 };
        const trendCompare = trendPriority[a.trend] - trendPriority[b.trend];
        if (trendCompare !== 0) return trendCompare;
        return Math.abs(b.variacaoPct) - Math.abs(a.variacaoPct);
      });
  }, [historico]);

  const produtos = useMemo(() => {
    const map = new Map<string, Produto>();
    for (const row of rows) {
      if (!row.produto) continue;
      if (familiaFilter !== "todas" && row.produto.familia_id !== familiaFilter) continue;
      map.set(row.produto.id, row.produto);
    }
    return sortByProductName(Array.from(map.values()), (produto) => produto.nome);
  }, [familiaFilter, rows]);

  function changeFamilia(value: string) {
    setFamiliaFilter(value);
    setSelectedProductIds([]);
  }

  const filtered = useMemo(() => {
    return rows
      .filter((row) => {
        if (familiaFilter !== "todas" && row.produto?.familia_id !== familiaFilter) return false;
        if (selectedProductIds.length > 0 && !selectedProductIds.includes(row.produto?.id ?? ""))
          return false;
        if (concorrenteFilter !== "todos" && row.concorrente?.id !== concorrenteFilter) {
          return false;
        }
        if (trendFilter !== "todos" && row.trend !== trendFilter) return false;
        return true;
      })
      .sort((a, b) => {
        const comparison = compareProductNames(a.produto?.nome ?? "", b.produto?.nome ?? "");
        if (comparison !== 0) return productOrder === "az" ? comparison : -comparison;
        return (a.concorrente?.nome ?? "").localeCompare(b.concorrente?.nome ?? "", "pt-BR");
      });
  }, [concorrenteFilter, familiaFilter, productOrder, rows, selectedProductIds, trendFilter]);

  function toggleProduct(productId: string) {
    setSelectedProductIds((current) =>
      current.includes(productId)
        ? current.filter((id) => id !== productId)
        : [...current, productId],
    );
  }

  function clearFilters() {
    setFamiliaFilter("todas");
    setSelectedProductIds([]);
    setProductOrder("az");
    setConcorrenteFilter("todos");
    setTrendFilter("todos");
  }

  const stats = useMemo(
    () => ({
      total: filtered.length,
      subiu: filtered.filter((row) => row.trend === "subiu").length,
      caiu: filtered.filter((row) => row.trend === "caiu").length,
      estavel: filtered.filter((row) => row.trend === "estavel").length,
      semComparacao: filtered.filter((row) => row.trend === "sem-comparacao").length,
    }),
    [filtered],
  );

  return (
    <>
      <PageHeader
        title="Monitoramento de Preços"
        description="Acompanhe quando o preço dos concorrentes subiu, caiu ou ficou estável desde a última coleta."
      />

      <Card className="mb-4 shadow-sm">
        <CardHeader className="flex flex-row items-center justify-between gap-3 pb-3">
          <CardTitle className="text-base">Filtros</CardTitle>
          <Button type="button" variant="ghost" size="sm" onClick={clearFilters}>
            <RotateCcw className="mr-1 h-4 w-4" /> Limpar filtros
          </Button>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          <Select value={concorrenteFilter} onValueChange={setConcorrenteFilter}>
            <SelectTrigger>
              <SelectValue placeholder="Concorrente" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todos os concorrentes</SelectItem>
              {concorrentes.map((concorrente) => (
                <SelectItem key={concorrente.id} value={concorrente.id}>
                  {concorrente.nome}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={familiaFilter} onValueChange={changeFamilia}>
            <SelectTrigger>
              <SelectValue placeholder="Família" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="todas">Todas as famílias</SelectItem>
              {familias.map((familia) => (
                <SelectItem key={familia.id} value={familia.id}>
                  {familia.nome}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Popover>
            <PopoverTrigger asChild>
              <Button type="button" variant="outline" className="justify-between font-normal">
                <span className="truncate">
                  {selectedProductIds.length === 0
                    ? "Todos os produtos"
                    : `${selectedProductIds.length} produto(s) selecionado(s)`}
                </span>
                <ChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
              </Button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-[var(--radix-popover-trigger-width)] p-2">
              <div className="max-h-72 space-y-1 overflow-y-auto">
                <label className="flex cursor-pointer items-center gap-2 rounded-sm px-2 py-2 text-sm hover:bg-accent">
                  <Checkbox
                    checked={selectedProductIds.length === 0}
                    onCheckedChange={() => setSelectedProductIds([])}
                  />
                  <span className="font-medium">Todos os produtos</span>
                </label>
                {produtos.map((produto) => (
                  <label
                    key={produto.id}
                    className="flex cursor-pointer items-start gap-2 rounded-sm px-2 py-2 text-sm hover:bg-accent"
                  >
                    <Checkbox
                      checked={selectedProductIds.includes(produto.id)}
                      onCheckedChange={() => toggleProduct(produto.id)}
                    />
                    <span className="leading-4">
                      {produto.sku_interno} - {produto.nome}
                    </span>
                  </label>
                ))}
              </div>
            </PopoverContent>
          </Popover>

          <Select
            value={productOrder}
            onValueChange={(value: "az" | "za") => setProductOrder(value)}
          >
            <SelectTrigger>
              <ArrowDownAZ className="mr-2 h-4 w-4" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="az">Produtos: A–Z (ordem ConstruJota)</SelectItem>
              <SelectItem value="za">Produtos: Z–A</SelectItem>
            </SelectContent>
          </Select>

          <Select value={trendFilter} onValueChange={setTrendFilter}>
            <SelectTrigger>
              <SelectValue placeholder="Variação" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todas as variações</SelectItem>
              <SelectItem value="subiu">Subiu</SelectItem>
              <SelectItem value="caiu">Caiu</SelectItem>
              <SelectItem value="estavel">Estável</SelectItem>
              <SelectItem value="sem-comparacao">Sem comparação</SelectItem>
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      <div className="mb-4 grid grid-cols-2 gap-4 md:grid-cols-5">
        <SummaryCard label="Monitorados" value={stats.total} />
        <SummaryCard label="Subiram" value={stats.subiu} tone="danger" icon="up" />
        <SummaryCard label="Caíram" value={stats.caiu} tone="success" icon="down" />
        <SummaryCard label="Estáveis" value={stats.estavel} />
        <SummaryCard label="Sem comparação" value={stats.semComparacao} />
      </div>

      <Card className="shadow-sm">
        <CardHeader>
          <CardTitle className="text-lg">Variação desde a coleta anterior</CardTitle>
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
                  <TableHead>Preço anterior</TableHead>
                  <TableHead>Preço atual</TableHead>
                  <TableHead>Variação</TableHead>
                  <TableHead>%</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Última coleta</TableHead>
                  <TableHead>Histórico recente</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading && (
                  <TableRow>
                    <TableCell colSpan={11} className="py-10 text-center text-muted-foreground">
                      Carregando monitoramento...
                    </TableCell>
                  </TableRow>
                )}
                {!loading && filtered.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={11} className="py-10 text-center text-muted-foreground">
                      Nenhuma variação encontrada
                    </TableCell>
                  </TableRow>
                )}
                {filtered.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="font-medium">{row.produto?.nome ?? "-"}</TableCell>
                    <TableCell className="font-mono text-xs">
                      {row.produto?.sku_interno ?? "-"}
                    </TableCell>
                    <TableCell>{row.concorrente?.nome ?? "-"}</TableCell>
                    <TableCell className="font-mono text-xs">{row.codigoConcorrente}</TableCell>
                    <TableCell>
                      {row.precoAnterior === null ? "-" : formatBRL(row.precoAnterior)}
                    </TableCell>
                    <TableCell>{formatBRL(row.precoAtual)}</TableCell>
                    <TableCell
                      className={
                        row.trend === "subiu"
                          ? "font-medium text-destructive"
                          : row.trend === "caiu"
                            ? "font-medium text-success"
                            : ""
                      }
                    >
                      <span className="inline-flex items-center gap-1">
                        {trendIcon(row.trend)}
                        {row.precoAnterior === null
                          ? "-"
                          : `${row.variacao > 0 ? "+" : ""}${formatBRL(row.variacao)}`}
                      </span>
                    </TableCell>
                    <TableCell
                      className={
                        row.trend === "subiu"
                          ? "font-medium text-destructive"
                          : row.trend === "caiu"
                            ? "font-medium text-success"
                            : ""
                      }
                    >
                      {row.precoAnterior === null ? "-" : formatPct(row.variacaoPct)}
                    </TableCell>
                    <TableCell>{trendBadge(row.trend)}</TableCell>
                    <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                      {formatDateTime(row.ultimaColeta)}
                    </TableCell>
                    <TableCell className="min-w-44">
                      <div className="flex flex-wrap gap-1">
                        {row.historico.map((item) => (
                          <span
                            key={item.id}
                            className="rounded border bg-muted/30 px-1.5 py-0.5 text-xs"
                            title={formatDateTime(item.coletado_em)}
                          >
                            {item.preco_concorrente === null
                              ? "-"
                              : formatBRL(item.preco_concorrente)}
                          </span>
                        ))}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </>
  );
}

function SummaryCard({
  label,
  value,
  tone,
  icon,
}: {
  label: string;
  value: number;
  tone?: "success" | "danger";
  icon?: "up" | "down";
}) {
  const Icon = icon === "up" ? TrendingUp : icon === "down" ? TrendingDown : null;

  return (
    <Card className="shadow-sm">
      <CardContent className="p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-xs font-medium text-muted-foreground">{label}</div>
            <div
              className={`mt-1 text-2xl font-bold ${
                tone === "danger" ? "text-destructive" : tone === "success" ? "text-success" : ""
              }`}
            >
              {value}
            </div>
          </div>
          {Icon && (
            <Icon
              className={`h-5 w-5 ${tone === "danger" ? "text-destructive" : "text-success"}`}
            />
          )}
        </div>
      </CardContent>
    </Card>
  );
}
