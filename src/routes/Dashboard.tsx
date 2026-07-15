import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatBRL, formatDateTime, formatPct, toDateString } from "@/lib/format";
import { compareProductNames, sortByProductName } from "@/lib/product-sort";
import { supabase } from "@/lib/supabase";
import {
  AlertTriangle,
  Boxes,
  CheckCircle2,
  Store,
  TrendingDown,
  TrendingUp,
  XCircle,
} from "lucide-react";
import {
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip as ReTooltip,
  XAxis,
  YAxis,
} from "recharts";
import { toast } from "sonner";

type Produto = {
  id: string;
  nome: string;
  sku_interno: string;
  familia_id: string | null;
  preco_atual: number;
  ativo: boolean;
  familias?: { id: string; nome: string } | null;
};

type Concorrente = {
  id: string;
  nome: string;
  ativo: boolean;
};

type Familia = {
  id: string;
  nome: string;
};

type Mapeamento = {
  id: string;
  sku_concorrente: string;
  ultimo_preco: number | null;
  ultima_atualizacao: string | null;
  status_coleta: "sucesso" | "erro" | "pendente";
  produtos?: Produto | null;
  concorrentes?: { id: string; nome: string } | null;
};

type Historico = {
  id: string;
  mapeamento_id: string;
  preco_concorrente: number | null;
  status: "sucesso" | "erro" | "pendente";
  coletado_em: string;
  mapeamentos_sku?: {
    id: string;
    concorrente_id: string;
    produtos?: { id: string; nome: string; sku_interno: string; familia_id: string | null } | null;
  } | null;
};

type Execucao = {
  id: string;
  status: "sucesso" | "parcial" | "erro" | "pendente";
  iniciado_em: string;
  finalizado_em: string | null;
  total_processados: number;
  total_sucesso: number;
  total_erro: number;
  mensagem: string;
  tempo_execucao_segundos: number;
};

function numeric(value: number | null | undefined) {
  return Number(value ?? 0);
}

function durationLabel(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, "0")}`;
}

const collator = new Intl.Collator("pt-BR", {
  numeric: true,
  sensitivity: "base",
});

export default function Dashboard() {
  const navigate = useNavigate();
  const [produtos, setProdutos] = useState<Produto[]>([]);
  const [familias, setFamilias] = useState<Familia[]>([]);
  const [concorrentes, setConcorrentes] = useState<Concorrente[]>([]);
  const [mapeamentos, setMapeamentos] = useState<Mapeamento[]>([]);
  const [historico, setHistorico] = useState<Historico[]>([]);
  const [execucoes, setExecucoes] = useState<Execucao[]>([]);
  const [concorrenteFilter, setConcorrenteFilter] = useState("todos");
  const [familiaFilter, setFamiliaFilter] = useState("todos");
  const [produtoFilter, setProdutoFilter] = useState("todos");
  const [loading, setLoading] = useState(true);

  async function refreshDashboard() {
    const [
      produtosResult,
      familiasResult,
      concorrentesResult,
      mapeamentosResult,
      historicoResult,
      execucoesResult,
    ] = await Promise.all([
      supabase
        .from("produtos")
        .select("id,nome,sku_interno,familia_id,preco_atual,ativo,familias(id,nome)")
        .order("nome"),
      supabase.from("familias").select("id,nome").eq("ativo", true).order("nome"),
      supabase.from("concorrentes").select("id,nome,ativo").order("nome"),
      supabase
        .from("mapeamentos_sku")
        .select(
          "id,sku_concorrente,ultimo_preco,ultima_atualizacao,status_coleta,produtos(id,nome,sku_interno,familia_id,preco_atual,ativo,familias(id,nome)),concorrentes(id,nome)",
        )
        .eq("ativo", true)
        .order("updated_at", { ascending: false }),
      supabase
        .from("historico_precos")
        .select(
          "id,mapeamento_id,preco_concorrente,status,coletado_em,mapeamentos_sku(id,concorrente_id,produtos(id,nome,sku_interno,familia_id))",
        )
        .eq("status", "sucesso")
        .order("coletado_em", { ascending: false })
        .limit(180),
      supabase
        .from("execucoes_robo")
        .select(
          "id,status,iniciado_em,finalizado_em,total_processados,total_sucesso,total_erro,mensagem,tempo_execucao_segundos",
        )
        .order("iniciado_em", { ascending: false })
        .limit(5),
    ]);

    if (
      produtosResult.error ||
      familiasResult.error ||
      concorrentesResult.error ||
      mapeamentosResult.error ||
      historicoResult.error ||
      execucoesResult.error
    ) {
      toast.error("Não foi possível carregar o dashboard");
      setLoading(false);
      return;
    }

    setProdutos(
      ((produtosResult.data ?? []) as Produto[]).map((produto) => ({
        ...produto,
        preco_atual: numeric(produto.preco_atual),
      })),
    );
    setFamilias((familiasResult.data ?? []) as Familia[]);
    setConcorrentes((concorrentesResult.data ?? []) as Concorrente[]);
    setMapeamentos(
      ((mapeamentosResult.data ?? []) as Mapeamento[]).map((mapeamento) => ({
        ...mapeamento,
        ultimo_preco: mapeamento.ultimo_preco === null ? null : numeric(mapeamento.ultimo_preco),
        produtos: mapeamento.produtos
          ? { ...mapeamento.produtos, preco_atual: numeric(mapeamento.produtos.preco_atual) }
          : null,
      })),
    );
    setHistorico(
      ((historicoResult.data ?? []) as Historico[]).map((row) => ({
        ...row,
        preco_concorrente: row.preco_concorrente === null ? null : numeric(row.preco_concorrente),
        coletado_em: toDateString(row.coletado_em),
      })),
    );
    setExecucoes((execucoesResult.data ?? []) as Execucao[]);
    setLoading(false);
  }

  useEffect(() => {
    void refreshDashboard();

    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") void refreshDashboard();
    }, 120000);

    return () => {
      window.clearInterval(interval);
    };
  }, []);

  const produtosDoFiltro = useMemo(() => {
    const next =
      familiaFilter === "todos"
        ? produtos
        : produtos.filter((produto) => produto.familia_id === familiaFilter);
    return sortByProductName(next, (produto) => produto.nome);
  }, [familiaFilter, produtos]);

  function changeFamiliaFilter(value: string) {
    setFamiliaFilter(value);
    setProdutoFilter("todos");
  }

  const filteredMapeamentos = useMemo(
    () =>
      mapeamentos.filter((mapeamento) => {
        const produto = mapeamento.produtos;
        const concorrente = mapeamento.concorrentes;

        if (concorrenteFilter !== "todos" && concorrente?.id !== concorrenteFilter) return false;
        if (familiaFilter !== "todos" && produto?.familia_id !== familiaFilter) return false;
        if (produtoFilter !== "todos" && produto?.id !== produtoFilter) return false;

        return true;
      }),
    [concorrenteFilter, familiaFilter, mapeamentos, produtoFilter],
  );

  const filteredHistorico = useMemo(
    () =>
      historico.filter((row) => {
        const mapeamento = row.mapeamentos_sku;
        const produto = mapeamento?.produtos;

        if (concorrenteFilter !== "todos" && mapeamento?.concorrente_id !== concorrenteFilter) {
          return false;
        }
        if (familiaFilter !== "todos" && produto?.familia_id !== familiaFilter) return false;
        if (produtoFilter !== "todos" && produto?.id !== produtoFilter) return false;

        return true;
      }),
    [concorrenteFilter, familiaFilter, historico, produtoFilter],
  );

  const filteredProdutos = useMemo(() => {
    const produtoIds = new Set(filteredMapeamentos.map((mapeamento) => mapeamento.produtos?.id));
    return produtos.filter((produto) => produtoIds.has(produto.id));
  }, [filteredMapeamentos, produtos]);

  const diffs = useMemo(
    () =>
      filteredMapeamentos
        .map((mapeamento) => {
          const produto = mapeamento.produtos;
          const precoCj = numeric(produto?.preco_atual);
          const precoConcorrente =
            mapeamento.ultimo_preco === null ? null : numeric(mapeamento.ultimo_preco);
          const hasPrice = precoConcorrente !== null && precoConcorrente > 0;
          const dif = hasPrice ? precoCj - precoConcorrente : null;
          const difPct = hasPrice ? (Number(dif) / precoConcorrente) * 100 : null;
          return {
            mapeamento,
            produto,
            concorrente: mapeamento.concorrentes,
            precoCj,
            precoConcorrente,
            dif,
            difPct,
          };
        })
        .sort((a, b) => {
          const concorrenteCompare = collator.compare(
            a.concorrente?.nome ?? "",
            b.concorrente?.nome ?? "",
          );
          if (concorrenteCompare !== 0) return concorrenteCompare;

          const produtoCompare = compareProductNames(a.produto?.nome ?? "", b.produto?.nome ?? "");
          if (produtoCompare !== 0) return produtoCompare;

          return collator.compare(
            a.mapeamento.sku_concorrente ?? "",
            b.mapeamento.sku_concorrente ?? "",
          );
        }),
    [filteredMapeamentos],
  );

  const stats = useMemo(() => {
    const comPreco = diffs.filter(
      (item) => item.precoConcorrente !== null && item.precoConcorrente > 0 && item.precoCj > 0,
    );
    const acima = comPreco.filter((item) => Number(item.dif) > 0).length;
    const abaixo = comPreco.filter((item) => Number(item.dif) < 0).length;
    const iguais = comPreco.filter((item) => item.dif === 0).length;
    const mediaPct =
      comPreco.reduce((acc, item) => acc + Number(item.difPct), 0) / Math.max(comPreco.length, 1);

    return { total: comPreco.length, acima, abaixo, iguais, mediaPct };
  }, [diffs]);

  const ultimaExec = execucoes[0];
  const semPreco = filteredMapeamentos.filter(
    (mapeamento) => !numeric(mapeamento.ultimo_preco),
  ).length;

  const chartData = useMemo(() => {
    const days = Array.from(
      new Set(
        filteredHistorico.map((row) => toDateString(row.coletado_em).slice(0, 10)).filter(Boolean),
      ),
    )
      .sort()
      .slice(-7);

    const firstMapeamentos = filteredMapeamentos.slice(0, 4);

    return days.map((day) => {
      const row: Record<string, number | string | null> = {
        dia: `${day.slice(8, 10)}/${day.slice(5, 7)}`,
      };

      firstMapeamentos.forEach((mapeamento) => {
        const produto = mapeamento.produtos;
        if (!produto) return;
        const historicoRow = filteredHistorico.find(
          (item) =>
            item.mapeamento_id === mapeamento.id && toDateString(item.coletado_em).startsWith(day),
        );
        row[`${produto.nome} (${produto.sku_interno})`] = historicoRow?.preco_concorrente ?? null;
      });

      return row;
    });
  }, [filteredHistorico, filteredMapeamentos]);

  const pieData = [
    { name: "Mais baratos", value: stats.abaixo, color: "var(--success)" },
    { name: "Mais caros", value: stats.acima, color: "var(--destructive)" },
    { name: "Iguais", value: stats.iguais, color: "var(--muted-foreground)" },
  ];

  const cards = [
    {
      icon: Boxes,
      label: "Produtos monitorados",
      value: filteredProdutos.filter((produto) => produto.ativo).length,
      sub: "No filtro",
      iconBg: "bg-primary/15 text-primary",
    },
    {
      icon: Store,
      label: "Concorrentes ativos",
      value: concorrentes.filter((concorrente) => concorrente.ativo).length,
      sub: "Ativos",
      iconBg: "bg-primary/15 text-primary",
    },
    {
      icon: TrendingUp,
      label: "Produtos acima do concorrente",
      value: stats.acima,
      sub: `${((stats.acima / Math.max(stats.total, 1)) * 100).toFixed(2)}% do total`,
      valueClass: "text-destructive",
    },
    {
      icon: TrendingDown,
      label: "Produtos abaixo do concorrente",
      value: stats.abaixo,
      sub: `${((stats.abaixo / Math.max(stats.total, 1)) * 100).toFixed(2)}% do total`,
      valueClass: "text-success",
    },
    {
      icon: AlertTriangle,
      label: "Coletas com erro",
      value: ultimaExec?.total_erro ?? 0,
      sub: `${(((ultimaExec?.total_erro ?? 0) / Math.max(ultimaExec?.total_processados ?? 0, 1)) * 100).toFixed(2)}% do total`,
      valueClass: "text-destructive",
    },
  ];

  return (
    <div className="space-y-6">
      <Card className="shadow-sm">
        <CardContent className="grid grid-cols-1 gap-3 p-4 md:grid-cols-3">
          <select
            value={concorrenteFilter}
            onChange={(event) => setConcorrenteFilter(event.target.value)}
            className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm outline-none transition-colors focus:ring-1 focus:ring-ring"
          >
            <option value="todos">Todos os concorrentes</option>
            {concorrentes
              .filter((concorrente) => concorrente.ativo)
              .map((concorrente) => (
                <option key={concorrente.id} value={concorrente.id}>
                  {concorrente.nome}
                </option>
              ))}
          </select>

          <select
            value={familiaFilter}
            onChange={(event) => changeFamiliaFilter(event.target.value)}
            className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm outline-none transition-colors focus:ring-1 focus:ring-ring"
          >
            <option value="todos">Todas as famílias</option>
            {familias.map((familia) => (
              <option key={familia.id} value={familia.id}>
                {familia.nome}
              </option>
            ))}
          </select>

          <select
            value={produtoFilter}
            onChange={(event) => setProdutoFilter(event.target.value)}
            className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm outline-none transition-colors focus:ring-1 focus:ring-ring"
          >
            <option value="todos">Todos os produtos</option>
            {produtosDoFiltro.map((produto) => (
              <option key={produto.id} value={produto.id}>
                {produto.sku_interno} - {produto.nome}
              </option>
            ))}
          </select>
        </CardContent>
      </Card>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-5">
        {cards.map((card) => {
          const Icon = card.icon;
          return (
            <Card key={card.label} className="shadow-sm">
              <CardContent className="p-5">
                <div className="mb-3 flex items-start justify-between">
                  <div
                    className={`flex h-10 w-10 items-center justify-center rounded-lg ${card.iconBg ?? "bg-primary/15 text-primary"}`}
                  >
                    <Icon className="h-5 w-5" />
                  </div>
                </div>
                <div className="min-h-[32px] text-xs font-medium leading-snug text-muted-foreground">
                  {card.label}
                </div>
                <div className={`mt-2 text-3xl font-bold ${card.valueClass ?? "text-foreground"}`}>
                  {card.value}
                </div>
                <div className="mt-1 text-xs text-muted-foreground">{card.sub}</div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <Card className="shadow-sm xl:col-span-2">
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-lg">Maiores diferenças de preço</CardTitle>
            <Button
              size="sm"
              onClick={() => navigate("/relatorios")}
              className="bg-primary text-primary-foreground hover:bg-primary/90"
            >
              Ver relatório completo
            </Button>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Produto</TableHead>
                  <TableHead>SKU CJ</TableHead>
                  <TableHead>Concorrente</TableHead>
                  <TableHead>Cód. Conc.</TableHead>
                  <TableHead>Preço CJ</TableHead>
                  <TableHead>Preço Conc.</TableHead>
                  <TableHead>Diferença</TableHead>
                  <TableHead>%</TableHead>
                  <TableHead>Última coleta</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading && (
                  <TableRow>
                    <TableCell colSpan={9} className="py-10 text-center text-muted-foreground">
                      Carregando dashboard...
                    </TableCell>
                  </TableRow>
                )}
                {!loading && diffs.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={9} className="py-10 text-center text-muted-foreground">
                      Nenhum preço coletado ainda
                    </TableCell>
                  </TableRow>
                )}
                {diffs.slice(0, 10).map((item) => (
                  <TableRow key={item.mapeamento.id}>
                    <TableCell className="font-medium">{item.produto?.nome ?? "-"}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {item.produto?.sku_interno ?? "-"}
                    </TableCell>
                    <TableCell>{item.concorrente?.nome ?? "-"}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {item.mapeamento.sku_concorrente}
                    </TableCell>
                    <TableCell>{formatBRL(item.precoCj)}</TableCell>
                    <TableCell>
                      {item.precoConcorrente !== null ? formatBRL(item.precoConcorrente) : "-"}
                    </TableCell>
                    <TableCell
                      className={
                        Number(item.dif) > 0
                          ? "font-medium text-destructive"
                          : Number(item.dif) < 0
                            ? "font-medium text-success"
                            : ""
                      }
                    >
                      {item.dif === null
                        ? "-"
                        : `${Number(item.dif) > 0 ? "+" : ""}${formatBRL(item.dif)}`}
                    </TableCell>
                    <TableCell
                      className={
                        Number(item.difPct) > 0
                          ? "font-medium text-destructive"
                          : Number(item.difPct) < 0
                            ? "font-medium text-success"
                            : ""
                      }
                    >
                      {item.difPct === null ? "-" : formatPct(item.difPct)}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                      {item.mapeamento.ultima_atualizacao
                        ? formatDateTime(item.mapeamento.ultima_atualizacao)
                        : "-"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Card className="shadow-sm">
            <CardHeader>
              <CardTitle className="text-base">Leitura rápida</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 text-sm">
              <Row label="Comparações com preço" value={`${stats.total}`} />
              <Row label="Mapeamentos sem coleta" value={`${semPreco}`} />
              <Row
                label="ConstruJota acima"
                value={`${stats.acima}`}
                valueClass="text-destructive"
              />
              <Row label="ConstruJota abaixo" value={`${stats.abaixo}`} valueClass="text-success" />
              <div className="rounded-md border bg-muted/30 p-3 text-xs text-muted-foreground">
                Diferença positiva significa que a ConstruJota está acima do preço do concorrente.
                Diferença negativa significa que está abaixo.
              </div>
            </CardContent>
          </Card>

          <Card className="shadow-sm">
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-base">Última execução do robô</CardTitle>
              <Badge variant={ultimaExec?.status === "erro" ? "destructive" : "secondary"}>
                {ultimaExec?.status ?? "sem execução"}
              </Badge>
            </CardHeader>
            <CardContent className="space-y-1.5 text-sm">
              <Row
                label="Início"
                value={ultimaExec ? formatDateTime(ultimaExec.iniciado_em) : "-"}
              />
              <Row
                label="Fim"
                value={ultimaExec?.finalizado_em ? formatDateTime(ultimaExec.finalizado_em) : "-"}
              />
              <Row label="Total processados" value={`${ultimaExec?.total_processados ?? 0}`} />
              <Row
                label="Sucesso"
                value={`${ultimaExec?.total_sucesso ?? 0}`}
                valueClass="text-success"
              />
              <Row
                label="Erros"
                value={`${ultimaExec?.total_erro ?? 0}`}
                valueClass="text-destructive"
              />
              <Row
                label="Tempo de execução"
                value={ultimaExec ? durationLabel(ultimaExec.tempo_execucao_segundos) : "-"}
              />
              <Button
                onClick={() => navigate("/execucoes-robo")}
                className="mt-3 w-full bg-primary text-primary-foreground hover:bg-primary/90"
              >
                Ver todas as execuções
              </Button>
            </CardContent>
          </Card>

          <Card className="shadow-sm">
            <CardHeader>
              <CardTitle className="text-base">Alertas</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div className="flex gap-3">
                <XCircle className="h-5 w-5 shrink-0 text-destructive" />
                <div>
                  <div className="font-medium">{ultimaExec?.total_erro ?? 0} coletas com erro</div>
                  <div className="text-xs text-muted-foreground">
                    Consulte os logs da última execução
                  </div>
                </div>
              </div>
              <div className="flex gap-3">
                <AlertTriangle className="h-5 w-5 shrink-0 text-primary" />
                <div>
                  <div className="font-medium">{filteredMapeamentos.length} mapeamentos ativos</div>
                  <div className="text-xs text-muted-foreground">
                    O robô usa esses mapeamentos para coletar preços
                  </div>
                </div>
              </div>
              <div className="flex gap-3">
                <CheckCircle2 className="h-5 w-5 shrink-0 text-success" />
                <div>
                  <div className="font-medium">{stats.total} comparações com preço coletado</div>
                  <div className="text-xs text-muted-foreground">Dados reais salvos no banco</div>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <Card className="border-primary/40 shadow-sm">
          <CardHeader>
            <CardTitle className="text-lg">Resumo geral</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="relative h-56">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={pieData}
                    dataKey="value"
                    innerRadius={62}
                    outerRadius={88}
                    paddingAngle={2}
                  >
                    {pieData.map((entry) => (
                      <Cell key={entry.name} fill={entry.color} />
                    ))}
                  </Pie>
                </PieChart>
              </ResponsiveContainer>
              <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                <div className="text-2xl font-bold">{stats.total}</div>
                <div className="text-xs text-muted-foreground">comparações</div>
              </div>
            </div>
            <ul className="mt-4 space-y-2 text-sm">
              {pieData.map((entry) => (
                <li key={entry.name} className="flex items-center justify-between gap-3">
                  <span className="flex items-center gap-2 text-muted-foreground">
                    <span
                      className="inline-block h-2.5 w-2.5 rounded-full"
                      style={{ background: entry.color }}
                    />
                    {entry.name}
                  </span>
                  <span className="font-semibold">{entry.value}</span>
                </li>
              ))}
            </ul>
            <div className="mt-4 border-t pt-3 text-xs text-muted-foreground">
              Última coleta:{" "}
              <span className="font-medium text-foreground">
                {ultimaExec?.finalizado_em
                  ? formatDateTime(ultimaExec.finalizado_em)
                  : "Sem coletas"}
              </span>
            </div>
          </CardContent>
        </Card>

        <Card className="shadow-sm xl:col-span-2">
          <CardHeader>
            <CardTitle className="text-lg">Evolução de preços</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData}>
                  <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" />
                  <XAxis dataKey="dia" stroke="var(--muted-foreground)" fontSize={12} />
                  <YAxis
                    stroke="var(--muted-foreground)"
                    fontSize={12}
                    tickFormatter={(value) => `R$ ${value}`}
                  />
                  <ReTooltip
                    formatter={(value: number) => formatBRL(value)}
                    contentStyle={{
                      background: "var(--card)",
                      border: "1px solid var(--border)",
                      borderRadius: 8,
                    }}
                  />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  {filteredMapeamentos.slice(0, 4).map((mapeamento, index) => {
                    const produto = mapeamento.produtos;
                    if (!produto) return null;
                    const colors = [
                      "var(--primary)",
                      "var(--secondary)",
                      "var(--success)",
                      "#3b82f6",
                    ];
                    return (
                      <Line
                        key={mapeamento.id}
                        type="monotone"
                        dataKey={`${produto.nome} (${produto.sku_interno})`}
                        stroke={colors[index]}
                        strokeWidth={2}
                        dot={{ r: 3 }}
                      />
                    );
                  })}
                </LineChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function Row({ label, value, valueClass }: { label: string; value: string; valueClass?: string }) {
  return (
    <div className="flex justify-between">
      <span className="text-muted-foreground">{label}:</span>
      <span className={`font-medium ${valueClass ?? ""}`}>{value}</span>
    </div>
  );
}
