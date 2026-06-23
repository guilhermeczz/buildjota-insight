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
import { formatBRL, formatDateTime, formatPct } from "@/lib/format";
import { supabase } from "@/lib/supabase";
import {
  AlertTriangle,
  Boxes,
  CheckCircle2,
  Percent,
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
  preco_atual: number;
  ativo: boolean;
};

type Concorrente = {
  id: string;
  ativo: boolean;
};

type Mapeamento = {
  id: string;
  sku_concorrente: string;
  ultimo_preco: number | null;
  ultima_atualizacao: string | null;
  status_coleta: "sucesso" | "erro" | "pendente";
  produtos?: Produto | null;
  concorrentes?: { nome: string } | null;
};

type Historico = {
  id: string;
  mapeamento_id: string;
  preco_concorrente: number;
  status: "sucesso" | "erro" | "pendente";
  coletado_em: string;
  mapeamentos_sku?: {
    id: string;
    produtos?: { nome: string; sku_interno: string } | null;
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

export default function Dashboard() {
  const navigate = useNavigate();
  const [produtos, setProdutos] = useState<Produto[]>([]);
  const [concorrentes, setConcorrentes] = useState<Concorrente[]>([]);
  const [mapeamentos, setMapeamentos] = useState<Mapeamento[]>([]);
  const [historico, setHistorico] = useState<Historico[]>([]);
  const [execucoes, setExecucoes] = useState<Execucao[]>([]);
  const [loading, setLoading] = useState(true);

  async function refreshDashboard() {
    const [
      produtosResult,
      concorrentesResult,
      mapeamentosResult,
      historicoResult,
      execucoesResult,
    ] = await Promise.all([
      supabase.from("produtos").select("id,nome,sku_interno,preco_atual,ativo").order("nome"),
      supabase.from("concorrentes").select("id,ativo"),
      supabase
        .from("mapeamentos_sku")
        .select(
          "id,sku_concorrente,ultimo_preco,ultima_atualizacao,status_coleta,produtos(id,nome,sku_interno,preco_atual,ativo),concorrentes(nome)",
        )
        .eq("ativo", true)
        .order("updated_at", { ascending: false }),
      supabase
        .from("historico_precos")
        .select(
          "id,mapeamento_id,preco_concorrente,status,coletado_em,mapeamentos_sku(id,produtos(nome,sku_interno))",
        )
        .eq("status", "sucesso")
        .order("coletado_em", { ascending: false })
        .limit(300),
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
        preco_concorrente: numeric(row.preco_concorrente),
      })),
    );
    setExecucoes((execucoesResult.data ?? []) as Execucao[]);
    setLoading(false);
  }

  useEffect(() => {
    void refreshDashboard();

    const channel = supabase
      .channel("dashboard-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "historico_precos" }, () => {
        void refreshDashboard();
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "execucoes_robo" }, () => {
        void refreshDashboard();
      })
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, []);

  const diffs = useMemo(
    () =>
      mapeamentos
        .map((mapeamento) => {
          const produto = mapeamento.produtos;
          const precoCj = numeric(produto?.preco_atual);
          const precoConcorrente = numeric(mapeamento.ultimo_preco);
          const dif = precoCj - precoConcorrente;
          const difPct = precoConcorrente > 0 ? (dif / precoConcorrente) * 100 : 0;
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
        .sort((a, b) => Math.abs(b.difPct) - Math.abs(a.difPct)),
    [mapeamentos],
  );

  const stats = useMemo(() => {
    const comPreco = diffs.filter((item) => item.precoConcorrente > 0 && item.precoCj > 0);
    const acima = comPreco.filter((item) => item.dif > 0).length;
    const abaixo = comPreco.filter((item) => item.dif < 0).length;
    const iguais = comPreco.filter((item) => item.dif === 0).length;
    const mediaPct =
      comPreco.reduce((acc, item) => acc + item.difPct, 0) / Math.max(comPreco.length, 1);

    return { total: comPreco.length, acima, abaixo, iguais, mediaPct };
  }, [diffs]);

  const ultimaExec = execucoes[0];
  const semPreco = mapeamentos.filter((mapeamento) => !numeric(mapeamento.ultimo_preco)).length;

  const chartData = useMemo(() => {
    const days = Array.from(new Set(historico.map((row) => row.coletado_em.slice(0, 10))))
      .sort()
      .slice(-7);

    const firstMapeamentos = mapeamentos.slice(0, 4);

    return days.map((day) => {
      const row: Record<string, number | string> = {
        dia: `${day.slice(8, 10)}/${day.slice(5, 7)}`,
      };

      firstMapeamentos.forEach((mapeamento) => {
        const produto = mapeamento.produtos;
        if (!produto) return;
        const historicoRow = historico.find(
          (item) => item.mapeamento_id === mapeamento.id && item.coletado_em.startsWith(day),
        );
        row[`${produto.nome} (${produto.sku_interno})`] = historicoRow?.preco_concorrente ?? 0;
      });

      return row;
    });
  }, [historico, mapeamentos]);

  const pieData = [
    { name: "Mais baratos", value: stats.abaixo, color: "var(--success)" },
    { name: "Mais caros", value: stats.acima, color: "var(--destructive)" },
    { name: "Iguais", value: stats.iguais, color: "var(--muted-foreground)" },
  ];

  const cards = [
    {
      icon: Boxes,
      label: "Produtos monitorados",
      value: produtos.filter((produto) => produto.ativo).length,
      sub: "Ativos",
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
      icon: Percent,
      label: "Diferença média percentual",
      value: `${stats.mediaPct.toFixed(2).replace(".", ",")}%`,
      sub: "Média geral",
      valueClass: stats.mediaPct >= 0 ? "text-destructive" : "text-success",
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
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
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
                  <TableHead>SKU Conc.</TableHead>
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
                    <TableCell>{formatBRL(item.precoConcorrente)}</TableCell>
                    <TableCell
                      className={
                        item.dif > 0
                          ? "font-medium text-destructive"
                          : item.dif < 0
                            ? "font-medium text-success"
                            : ""
                      }
                    >
                      {item.dif > 0 ? "+" : ""}
                      {formatBRL(item.dif)}
                    </TableCell>
                    <TableCell
                      className={
                        item.difPct > 0
                          ? "font-medium text-destructive"
                          : item.difPct < 0
                            ? "font-medium text-success"
                            : ""
                      }
                    >
                      {formatPct(item.difPct)}
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
                  <div className="font-medium">{mapeamentos.length} mapeamentos ativos</div>
                  <div className="text-xs text-muted-foreground">
                    O robô usa esses mapeamentos para coletar preços
                  </div>
                </div>
              </div>
              <div className="flex gap-3">
                <CheckCircle2 className="h-5 w-5 shrink-0 text-success" />
                <div>
                  <div className="font-medium">{stats.total} comparações com preço coletado</div>
                  <div className="text-xs text-muted-foreground">
                    Dados reais salvos no Supabase
                  </div>
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
                  {mapeamentos.slice(0, 4).map((mapeamento, index) => {
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
